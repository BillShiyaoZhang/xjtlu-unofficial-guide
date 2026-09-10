import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from './build-pages.mjs';
import { validateTopicsConfig } from '../community/pages-ui/topic-model.js';
import { createColdStartFixtures, fixtureRepository, previewDisclosure } from '../tests/fixtures/cold-start/scenarios.mjs';

const assets = ['index.html', 'app.js', 'contributions.js', 'topic-model.js', 'discussions.js', 'search.js', 'community.js',
  'style.css', 'brand.svg', 'branches.js', 'branch-model.js', 'branches.css', 'core/index.js', 'core/branches.js', 'public.json', 'community-topics.json'];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const fixtureFile = name => new URL(`../tests/fixtures/cold-start/${name}`, import.meta.url);
const policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Build the ordinary production bundle, then overlay synthetic data in memory only. */
export async function startColdStartPreview({ root = resolve('.'), port = 4319, now = Date.now() } = {}) {
  const built = await buildPages({ root });
  const bodies = new Map(await Promise.all(assets.map(async name => [name, await readFile(resolve(built.output, name), 'utf8')])));
  const snapshot = JSON.parse(bodies.get('public.json'));
  const fixtures = createColdStartFixtures({ now });
  validateTopicsConfig(fixtures.topics, snapshot.catalog);
  snapshot.site = { ...snapshot.site, contributionsRepository: fixtureRepository };
  bodies.set('public.json', JSON.stringify(snapshot));
  bodies.set('community-topics.json', JSON.stringify(fixtures.topics));
  bodies.set('contributions.js', await readFile(fixtureFile('contributions.js'), 'utf8'));
  bodies.set('cold-start-guard.js', await readFile(fixtureFile('guard.js'), 'utf8'));
  bodies.set('cold-start-preview.css', '.cold-start-banner{background:#fff1a8;color:#332900;border:3px solid #ad7300;padding:1rem;margin:1rem;font-weight:700;line-height:1.7}.cold-start-banner p{margin:.25rem 0}.cold-start-banner a{color:inherit;text-decoration:underline}');
  const banner = `<aside class="cold-start-banner" aria-label="合成测试数据说明"><strong>${previewDisclosure}</strong><p>启动基准：${fixtures.now}；活动时间相对启动时生成。已有资料保留正式快照。</p><p><a href="#/topics/test-question">提问与回复</a> · <a href="#/topics/test-event-open">开放报名</a> · <a href="#/topics/test-event-closed">报名截止</a> · <a href="#/topics/test-event-postponed">延期</a> · <a href="#/topics/test-event-rescheduled">改期</a> · <a href="#/topics/test-event-cancelled">取消</a> · <a href="#/topics/test-event-past">已过计划时间</a> · <a href="#/topics/test-incident-ongoing">持续影响</a> · <a href="#/topics/test-incident-resolved">已解决</a> · <a href="#/topics/test-incident-unknown">待确认</a></p><p id="cold-start-preview-notice" role="status" tabindex="-1">可展开合成回复、切换历史记录，并试写本地草稿。</p></aside>`;
  const html = bodies.get('index.html');
  if (!html.includes('<body>') || !html.includes('</head>')) throw new Error('cold-start preview requires the standard Pages HTML shell');
  bodies.set('index.html', html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/u, '')
    .replace('</head>', '<link rel="stylesheet" href="./cold-start-preview.css"><script src="./cold-start-guard.js"></script></head>')
    .replace('<body>', '<body>' + banner).replace('<title>', '<title>【测试样例】'));
  // The regular production strings must never call these synthetic records real submissions.
  bodies.set('community.js', bodies.get('community.js').replaceAll('正在读取真实投稿', '正在读取合成测试投稿'));
  let origin;
  const server = createServer((request, response) => {
    const send = (status, body = '', type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': policy,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(request.headers.host)) return send(403, 'Local preview only.');
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Read-only synthetic preview; no submissions are accepted.');
      const url = new URL(request.url, origin);
      const path = decodeURIComponent(url.pathname);
      const apiRoot = `/mock-github/repos/${fixtureRepository}/issues`;
      if (path === apiRoot || path.startsWith(apiRoot + '/')) {
        const page = url.searchParams.get('page') ?? '1';
        if (!/^[1-9]\d*$/u.test(page)) return send(400, 'Invalid preview page.');
        let value;
        if (path === apiRoot) value = Number(page) === 1 ? fixtures.issues : [];
        else {
          const match = path.slice(apiRoot.length).match(/^\/([1-9]\d*)(\/comments)?$/u);
          const issue = match && fixtures.issues.find(row => row.number === Number(match[1]));
          if (!issue) return send(404, 'Synthetic discussion not found.');
          value = match[2] ? Number(page) === 1 ? fixtures.replies[issue.number] : [] : issue;
        }
        return send(200, JSON.stringify(value), types['.json']);
      }
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (!bodies.has(name)) return send(404);
      let body = bodies.get(name);
      if (name === 'discussions.js') {
        // Keep exact GitHub permalink validation, but direct every API URL to this server.
        const requestOrigin = `http://${request.headers.host}`;
        body = body.replaceAll('https://api.github.com/repos/', `${requestOrigin}/mock-github/repos/`)
          .replaceAll("'https://api.github.com'", JSON.stringify(requestOrigin));
        if (body.includes('https://api.github.com')) throw new Error('Unmapped remote discussion request');
      }
      return send(200, body, types[extname(name)]);
    } catch { return send(400, 'Invalid local preview request.'); }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { ...built, server, origin, fixtures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await startColdStartPreview();
  console.log(`Synthetic cold-start preview: ${preview.origin}/`);
  console.log(`${preview.fixtures.topics.topics.length} synthetic topics, ${preview.fixtures.issues.length} synthetic discussions. ${previewDisclosure}`);
}
