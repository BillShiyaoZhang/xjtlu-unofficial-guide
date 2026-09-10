import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Public GET routes observed in the H5 client. No credentials, signatures or user profiles.
const origin = 'https://api.zhitiaox.com';
const cache = new URL('../community/.cold-start-cache/', import.meta.url);
const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
export const shareUrl = id => {
  if (!validId(id)) throw new Error('Invalid post ID');
  return `https://h5.zhitiaox.com/#/pages/forum/forum?id=${id}`;
};

// A preliminary omission filter only; retained candidates still require editorial selection.
const sensitive = /LGBT|Pride|拉拉|男同|女同|出柜|性取向|抑郁|焦虑|自杀|自残|确诊|诊断|病历|挂一个|曝光|身份证|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:微信|vx|v信|QQ|学号)\s*[:：号]?\s*[a-z0-9_-]{5,}/iu;
export function candidateFromMessage(row, accessedAt) {
  if (!row || !validId(row._id) || row.school !== 'XJTLU' || row.deleted !== false) return null;
  if (typeof row.content !== 'string' || !row.content.trim() || row.content.length > 6000 || !validDate(row.createdAt)) return null;
  if (sensitive.test(`${row.carton?.title ?? ''}\n${row.content}`)) return null;
  if (row._id === '63341a38526af227cc7d69c7') return null; // retired-client upgrade notice
  return {
    id: row._id, url: shareUrl(row._id), school: 'XJTLU', content: row.content.trim(),
    createdAt: row.createdAt, ...(validDate(row.updatedAt) ? { updatedAt: row.updatedAt } : {}),
    accessedAt, contentSha256: createHash('sha256').update(row.content).digest('hex'),
  };
}

export function parseOptions(args) {
  const options = { pages: 1, ids: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pages' && /^[1-3]$/.test(args[i + 1] ?? '')) options.pages = Number(args[++i]);
    else if (args[i] === '--post' && validId(args[i + 1])) options.ids.push(args[++i]);
    else throw new Error('Usage: node scripts/collect-zhitiao.mjs [--pages 1..3] [--post POST_ID ...]');
  }
  options.ids = [...new Set(options.ids)];
  if (options.ids.length > 20) throw new Error('At most 20 explicitly selected posts per run');
  return options;
}

export async function collectZhitiao({ pages = 1, ids = [], fetchImpl = fetch, pause = delay, now = () => new Date().toISOString() } = {}) {
  if (!Number.isInteger(pages) || pages < 1 || pages > 3 || ids.length > 20 || !ids.every(validId)) throw new Error('Invalid collection limits');
  const report = { schemaVersion: 1, platform: '纸条', collectedAt: now(), purpose: 'Local editorial candidates; not a public import batch',
    attempts: [], candidates: [], omitted: 0, duplicates: 0, stopped: false };
  const seen = new Set();
  let requested = false;
  async function request(path) {
    if (report.stopped) return null;
    if (requested) await pause(1200);
    requested = true;
    const attempt = { url: origin + path, accessedAt: now() };
    report.attempts.push(attempt);
    try {
      const response = await fetchImpl(attempt.url, { method: 'GET', redirect: 'error',
        headers: { accept: 'application/json', school: 'XJTLU' }, signal: AbortSignal.timeout(20000) });
      attempt.httpStatus = response.status;
      if (!response.ok) {
        attempt.status = [401, 403].includes(response.status) ? 'access-required' : response.status === 429 ? 'rate-limited' : 'http-error';
        report.stopped = true;
        return null;
      }
      const reader = response.body.getReader();
      let length = 0;
      const chunks = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('response-too-large'); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const detail = /^\/message\/[a-f0-9]{24}$/.test(path);
      if (detail ? (!data.message || data.message._id !== path.split('/').at(-1)) : !Array.isArray(data.messages)) throw new Error('unexpected-response');
      const rows = detail ? [data.message] : data.messages;
      attempt.status = rows.length && rows.every(row => row._id === '63341a38526af227cc7d69c7') ? 'retired-client' : 'read';
      attempt.received = rows.length;
      for (const row of rows) {
        const candidate = candidateFromMessage(row, attempt.accessedAt);
        if (!candidate) { report.omitted++; continue; }
        if (seen.has(candidate.id)) { report.duplicates++; continue; }
        seen.add(candidate.id);
        report.candidates.push(candidate);
      }
      return rows;
    } catch (error) {
      attempt.status = ['response-too-large', 'unexpected-response'].includes(error.message) ? error.message : 'network-or-invalid-json';
      report.stopped = true;
      return null;
    }
  }
  if (ids.length) {
    for (const id of [...new Set(ids)]) { await request(`/message/${id}`); if (report.stopped) break; }
  } else {
    let cursor;
    const cursors = new Set();
    for (let page = 0; page < pages; page++) {
      const rows = await request('/message/latest' + (cursor ? `?updatedAt=${encodeURIComponent(cursor)}` : ''));
      if (!rows?.length || report.stopped) break;
      const next = rows.at(-1)?.updatedAt;
      if (!validDate(next) || cursors.has(next)) break;
      cursors.add(next); cursor = next;
    }
    if (!report.stopped) await request('/message/hot');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await collectZhitiao(parseOptions(process.argv.slice(2)));
  await mkdir(cache, { recursive: true });
  const output = new URL(`${report.collectedAt.replace(/[:.]/g, '-')}.json`, cache);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: fileURLToPath(output), candidates: report.candidates.length, omitted: report.omitted,
    duplicates: report.duplicates, stopped: report.stopped, attempts: report.attempts }, null, 2));
  if (report.stopped) process.exitCode = 1;
}
