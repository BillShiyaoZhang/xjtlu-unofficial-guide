export const reviewDecisionLabels = {
  pending: '待审核', approved: '审核通过', 'changes-requested': '需修改',
  'needs-verification': '待核', excluded: '不收录',
};
const reviewActionLabels = { ...reviewDecisionLabels, approved: '通过并发布' };

const pageSize = 8;
const decisionValues = Object.keys(reviewDecisionLabels).filter(value => value !== 'pending');
const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const formattedDate = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';
const option = (value, label) => {
  const node = make('option', '', label);
  node.value = value;
  return node;
};
const sameVersion = (article, saved) => article.revisionId === saved.revisionId
  && article.version === saved.version && (article.latestReview?.id ?? null) === saved.reviewId;

export function createArticleReview({ api, mutate, message, errorMessage, getPermissions }) {
  let articles = [], topics = new Map(), selections = new Map(), expanded = new Set();
  let page = 0, generation = 0, loading = false, submitting = false;
  const canRead = () => getPermissions().includes('content:read');
  const canReview = () => getPermissions().includes('content:publish');
  const topicLabel = article => topics.get(article.topicId) ?? article.topicId ?? '未分类';
  const visible = () => {
    const search = $('#article-search').value.trim().toLocaleLowerCase('zh-CN');
    const topic = $('#article-topic-filter').value, status = $('#article-status-filter').value;
    return articles.filter(article => (!topic || topic === article.topicId)
      && (!status || status === article.reviewStatus)
      && (!search || [article.title, article.summary, article.entityId, ...article.sentences.map(sentence => sentence.text)]
        .join(' ').toLocaleLowerCase('zh-CN').includes(search)));
  };
  const currentPage = () => visible().slice(page * pageSize, (page + 1) * pageSize);
  const draftFor = article => selections.get(article.entityId) ?? {
    article, decision: article.latestReview?.decision ?? 'approved', reason: '',
  };

  function updateControls() {
    const busy = loading || submitting, filtered = visible();
    const pages = Math.ceil(filtered.length / pageSize);
    const pageArticles = currentPage(), selectedOnPage = pageArticles.filter(article => selections.has(article.entityId)).length;
    $('#article-total').textContent = `共 ${articles.length} 篇`;
    $('#article-result-count').textContent = `符合条件 ${filtered.length} 篇`;
    $('#article-page-label').textContent = `${pages ? page + 1 : 0} / ${pages}`;
    $('#article-selection-count').textContent = `已勾选 ${selections.size} 篇`;
    $('#article-select-page').checked = pageArticles.length > 0 && selectedOnPage === pageArticles.length;
    $('#article-select-page').indeterminate = selectedOnPage > 0 && selectedOnPage < pageArticles.length;
    $('#article-select-page').disabled = busy || !canReview() || !pageArticles.length;
    $('#article-previous-page').disabled = busy || !page;
    $('#article-next-page').disabled = busy || page + 1 >= pages;
    $('#article-expand-page').disabled = busy || !pageArticles.length;
    $('#article-expand-page').textContent = pageArticles.length && pageArticles.every(article => expanded.has(article.entityId)) ? '收起本页正文' : '展开本页正文';
    $('#batch-submit').disabled = busy || !canReview() || !selections.size;
    const publishCount = [...selections.values()].filter(item => item.decision === 'approved').length;
    $('#batch-submit').textContent = submitting ? '正在提交审核与发布…' : publishCount
      ? `提交 ${selections.size} 篇审核并发布 ${publishCount} 篇` : `提交已选 ${selections.size} 篇的审核`;
    $('#batch-submit').setAttribute('aria-busy', String(submitting));
    $('#batch-clear').disabled = busy || !selections.size;
    $('#batch-apply').disabled = busy || !canReview() || !selections.size;
    for (const id of ['article-search', 'article-topic-filter', 'article-status-filter']) $(`#${id}`).disabled = busy || !canRead();
    for (const id of ['batch-decision', 'batch-reason']) $(`#${id}`).disabled = busy || !canReview();
    for (const input of $('#article-list').querySelectorAll('input, select, textarea')) input.disabled = busy || !canReview();
    const summary = $('#batch-selection-summary');
    summary.replaceChildren();
    if (selections.size) {
      for (const decision of decisionValues) {
        const count = [...selections.values()].filter(item => item.decision === decision).length;
        if (count) summary.append(make('span', `tag review-${decision}`, `${reviewActionLabels[decision]} ${count} 篇`));
      }
      summary.append(make('p', 'muted', publishCount
        ? `本次提交将立即公开 ${publishCount} 篇文章，其余 ${selections.size - publishCount} 篇仅保存审核意见。`
        : '本次提交仅保存审核意见。'));
      const offscreen = selections.size - selectedOnPage;
      if (offscreen) summary.append(make('p', 'muted', `另有 ${offscreen} 篇已选文章不在当前页。`));
    }
  }

  function renderArticle(article) {
    const card = make('article', 'article-card');
    card.dataset.entityId = article.entityId;
    card.dataset.revisionId = article.revisionId;
    card.classList.toggle('is-selected', selections.has(article.entityId));
    const head = make('div', 'article-card-heading');
    const selectLabel = make('label', 'checkbox-label article-select-label');
    const checkbox = make('input', 'article-select');
    checkbox.type = 'checkbox'; checkbox.checked = selections.has(article.entityId);
    checkbox.setAttribute('aria-label', `勾选文章：${article.title}`);
    selectLabel.append(checkbox, make('span', '', '勾选'));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        const draft = draftFor(article);
        selections.set(article.entityId, draft);
        decision.value = draft.decision; reason.value = draft.reason;
      }
      else selections.delete(article.entityId);
      card.classList.toggle('is-selected', checkbox.checked);
      controls.hidden = !checkbox.checked;
      updateControls();
    });
    const meta = make('div', 'article-card-meta');
    meta.append(make('span', 'article-topic', topicLabel(article)), make('span', `tag review-${article.reviewStatus}`, reviewDecisionLabels[article.reviewStatus] ?? article.reviewStatus));
    if (article.demo) meta.append(make('span', 'tag', '演示文章'));
    head.append(selectLabel, meta);
    card.append(head);

    const details = make('details', 'article-content');
    details.open = expanded.has(article.entityId);
    const summary = make('summary', 'article-summary');
    summary.append(make('h3', '', article.title));
    const summaryText = make('p', 'article-summary-text', article.summary);
    if (article.summary) summary.append(summaryText);
    summary.append(make('span', 'article-expand-label', '正文与来源'));
    details.append(summary);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) expanded.add(article.entityId); else expanded.delete(article.entityId);
      updateControls();
    });
    const content = make('div', 'article-full-content');
    const metadata = make('dl', 'metadata article-metadata');
    for (const [label, value] of [
      ['适用范围', article.scope || '未注明'],
      ['内容来源', article.origin === 'human' && article.originalOrigin === 'ai_draft'
        ? 'AI 辅助初稿，经人工审核确认'
        : article.origin === 'human' && article.reviewedFromRevisionId ? '经人工审核确认'
          : ({ ai_draft: 'AI 辅助初稿', human: '人工撰写' })[article.origin] ?? article.origin ?? '未注明'],
      ['资料收集', article.researchedAt || '未记录'],
      ['人工核验', article.verifiedAt || '尚未核验'],
      ['信息截至', article.asOf || '未注明'],
      ['下次复核', article.reviewDueAt || '未安排'],
      ['公开状态', article.hidden ? '已隐藏' : article.publicRevisionId === article.revisionId ? '本修订已公开' : '本修订未公开'],
      ['文章 ID', article.entityId], ['修订 ID', article.revisionId],
      ['修订序号', article.revisionNumber ?? '未记录'],
    ]) metadata.append(make('dt', '', label), make('dd', '', String(value)));
    if (article.reviewedFromRevisionId) metadata.append(make('dt', '', '审核原稿'), make('dd', '', article.reviewedFromRevisionId));
    content.append(metadata);
    if (article.evidenceNote) content.append(make('p', 'article-evidence-note', `资料核对说明：${article.evidenceNote}`));
    const sentences = make('div', 'article-sentences');
    for (const sentence of article.sentences) {
      const block = make('div', 'article-sentence');
      if (['fact', 'advice'].includes(sentence.kind)) block.append(make('span', 'sentence-kind', sentence.kind === 'fact' ? '事实' : '建议'));
      block.append(make('p', '', sentence.text));
      if (sentence.citations?.length) {
        const citations = make('ul', 'article-citations');
        for (const citation of sentence.citations) {
          const row = make('li');
          let href;
          try { const url = new URL(citation.url); if (['https:', 'http:'].includes(url.protocol)) href = url.href; } catch { /* Keep invalid links as plain text. */ }
          const link = make(href ? 'a' : 'span', '', citation.title || citation.sourceId || '来源');
          if (href) {
            link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer'; link.setAttribute('aria-label', `${link.textContent}（新标签页）`);
          }
          row.append(link);
          const context = [citation.locator, citation.accessedAt ? `访问于 ${citation.accessedAt}` : ''].filter(Boolean).join(' · ');
          if (context) row.append(make('span', 'citation-context', context));
          if (citation.sourceHidden || (citation.sourceDisposition && citation.sourceDisposition !== 'active')) {
            row.append(make('span', 'citation-warning', citation.sourceHidden ? '来源已隐藏，请重新核对依据。' : `来源状态：${({ withdrawn: '已撤回', 'rights-expired': '使用权到期' })[citation.sourceDisposition] ?? citation.sourceDisposition}，请重新核对依据。`));
          }
          citations.append(row);
        }
        block.append(citations);
      }
      sentences.append(block);
    }
    if (!article.sentences.length) sentences.append(make('p', 'muted', '此修订没有可展示的正文。'));
    content.append(sentences);
    if (article.latestReview) {
      const review = make('div', 'article-latest-review');
      review.append(make('h4', '', `最近审核 · ${reviewDecisionLabels[article.latestReview.decision] ?? article.latestReview.decision}`));
      review.append(make('p', '', article.latestReview.reason));
      review.append(make('small', 'muted', `${article.latestReview.actorId} · ${formattedDate(article.latestReview.createdAt)}`));
      if (article.latestReview.publishedRevisionId) review.append(make('p', 'muted', `本次审核发布修订：${article.latestReview.publishedRevisionId}`));
      content.append(review);
    }
    details.append(content); card.append(details);

    const controls = make('div', 'article-review-fields');
    controls.hidden = !checkbox.checked;
    const draft = draftFor(article), decisionLabel = make('label', '', '本篇结论');
    const decision = make('select', 'article-decision');
    decision.setAttribute('aria-label', `本篇结论：${article.title}`);
    for (const value of decisionValues) decision.append(option(value, reviewActionLabels[value]));
    decision.value = draft.decision;
    decisionLabel.append(decision);
    const reasonLabel = make('label', '', '本篇意见（8–400 字）');
    const reason = make('textarea', 'article-reason');
    reason.rows = 3; reason.maxLength = 400; reason.minLength = 8; reason.value = draft.reason;
    reason.placeholder = '记录核对依据，或指出需要修改、补充核验的内容';
    reason.setAttribute('aria-label', `本篇意见：${article.title}`);
    reasonLabel.append(reason);
    decision.addEventListener('change', () => {
      if (selections.has(article.entityId)) selections.get(article.entityId).decision = decision.value;
      updateControls();
    });
    reason.addEventListener('input', () => {
      reason.setCustomValidity('');
      if (selections.has(article.entityId)) selections.get(article.entityId).reason = reason.value;
    });
    controls.append(decisionLabel, reasonLabel); card.append(controls);
    return card;
  }

  function render() {
    const filtered = visible();
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    const list = $('#article-list'); list.replaceChildren();
    for (const article of currentPage()) list.append(renderArticle(article));
    if (!filtered.length) list.append(make('p', 'empty', articles.length ? '没有符合当前筛选条件的文章。可以切换章节或审核状态。' : '暂无可审核文章。'));
    updateControls();
  }

  function clear() {
    generation++;
    articles = []; topics = new Map(); selections = new Map(); expanded = new Set();
    page = 0; loading = false; submitting = false;
    $('#article-list').replaceChildren();
    $('#article-search').value = '';
    $('#article-status-filter').value = 'pending';
    $('#article-topic-filter').replaceChildren(option('', '全部章节'));
    $('#batch-review-form').reset();
    $('#batch-apply-status').textContent = ''; $('#batch-apply-status').hidden = true;
    $('#article-permission').textContent = ''; $('#article-permission').hidden = true;
    updateControls();
  }

  function snapshot() {
    if (!articles.length) return null;
    return {
      selections: [...selections.values()].map(({ article, decision, reason }) => ({
        entityId: article.entityId, revisionId: article.revisionId, version: article.version,
        reviewId: article.latestReview?.id ?? null, decision, reason,
      })),
      expanded: [...expanded], page, search: $('#article-search').value,
      topic: $('#article-topic-filter').value, status: $('#article-status-filter').value,
      commonDecision: $('#batch-decision').value, commonReason: $('#batch-reason').value,
    };
  }

  async function load(saved = null) {
    const current = ++generation;
    if (!canRead()) {
      $('#article-permission').textContent = '当前账户没有读取文章正文的权限。';
      $('#article-permission').hidden = false; updateControls(); return;
    }
    loading = true;
    $('#article-list').replaceChildren(make('p', 'empty', '正在读取文章与审核记录…'));
    updateControls();
    try {
      const [result, catalog] = await Promise.all([api('/api/guide/review-articles'), api('/api/guide/catalog')]);
      if (current !== generation) return;
      articles = result.articles;
      topics = new Map((catalog.topics ?? []).map(topic => [topic.id, topic.titleZh ?? topic.title ?? topic.id]));
      const topicFilter = $('#article-topic-filter'), previousTopic = saved?.topic ?? topicFilter.value;
      topicFilter.replaceChildren(option('', '全部章节'));
      for (const id of [...new Set(articles.map(article => article.topicId))].filter(Boolean)) topicFilter.append(option(id, topics.get(id) ?? id));
      topicFilter.value = [...topicFilter.options].some(entry => entry.value === previousTopic) ? previousTopic : '';
      $('#article-permission').textContent = canReview() ? '' : '当前账户可查看文章和审核记录；提交审核需要内容审核员权限。';
      $('#article-permission').hidden = canReview();
      if (saved) {
        selections.clear();
        let skipped = 0;
        for (const entry of saved.selections) {
          const article = articles.find(article => article.entityId === entry.entityId);
          if (article && sameVersion(article, entry) && canReview()) selections.set(article.entityId, { article, decision: entry.decision, reason: entry.reason });
          else skipped++;
        }
        expanded = new Set(saved.expanded.filter(id => articles.some(article => article.entityId === id)));
        page = saved.page; $('#article-search').value = saved.search; $('#article-status-filter').value = saved.status;
        $('#batch-decision').value = saved.commonDecision; $('#batch-reason').value = saved.commonReason;
        if (skipped) message(`有 ${skipped} 篇文章或审核记录已变化，已取消其勾选。请重新核对后填写意见。`, 'error');
      }
      render();
    } catch (error) {
      if (current === generation) $('#article-list').replaceChildren(make('p', 'empty', '文章读取未完成。请使用顶部刷新按钮重试。'));
      throw error;
    } finally {
      if (current === generation) { loading = false; updateControls(); }
    }
  }

  for (const id of ['article-search', 'article-topic-filter', 'article-status-filter']) {
    $(`#${id}`).addEventListener(id === 'article-search' ? 'input' : 'change', () => { page = 0; render(); });
  }
  $('#article-previous-page').addEventListener('click', () => { page--; render(); });
  $('#article-next-page').addEventListener('click', () => { page++; render(); });
  $('#article-select-page').addEventListener('change', event => {
    for (const article of currentPage()) {
      if (event.target.checked) selections.set(article.entityId, draftFor(article));
      else selections.delete(article.entityId);
    }
    render();
  });
  $('#article-expand-page').addEventListener('click', () => {
    const rows = currentPage(), collapse = rows.every(article => expanded.has(article.entityId));
    for (const article of rows) { if (collapse) expanded.delete(article.entityId); else expanded.add(article.entityId); }
    render();
  });
  $('#batch-clear').addEventListener('click', () => { selections.clear(); render(); });
  $('#batch-apply').addEventListener('click', () => {
    if (!selections.size || !canReview()) return;
    const decision = $('#batch-decision').value, reason = $('#batch-reason').value.trim();
    if (!decision && !reason) return message('请先填写共同结论或共同意见，再应用到已选文章。', 'error');
    if (reason && (reason.length < 8 || reason.length > 400)) return message('共同意见需要 8 至 400 字。', 'error');
    for (const draft of selections.values()) {
      if (decision) draft.decision = decision;
      if (reason) draft.reason = reason;
    }
    $('#batch-apply-status').textContent = `已应用到 ${selections.size} 篇，可逐篇继续调整。`;
    $('#batch-apply-status').hidden = false;
    render();
  });
  $('#batch-review-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || loading || !canReview() || !selections.size) return;
    const items = [...selections.values()].map(({ article, decision, reason }) => ({
      entityId: article.entityId, revisionId: article.revisionId, expectedVersion: article.version,
      expectedReviewId: article.latestReview?.id ?? null, decision, reason: reason.trim(),
    }));
    const invalid = items.find(item => !decisionValues.includes(item.decision) || item.reason.length < 8 || item.reason.length > 400);
    if (invalid) {
      const article = selections.get(invalid.entityId).article;
      message(`「${article.title}」尚未填写完整：请选择结论，并填写 8 至 400 字的本篇意见。也可使用共同意见批量填写。`, 'error');
      // Bring off-page selections into view so a validation error is actionable.
      $('#article-search').value = ''; $('#article-topic-filter').value = ''; $('#article-status-filter').value = '';
      page = Math.floor(articles.findIndex(article => article.entityId === invalid.entityId) / pageSize);
      render();
      const card = [...$('#article-list').children].find(card => card.dataset.entityId === invalid.entityId);
      card?.querySelector('.article-reason')?.focus();
      return;
    }
    const current = generation;
    submitting = true; updateControls();
    try {
      const result = await mutate('/api/guide/reviews/batch', { mode: 'review-and-publish', items });
      if (current !== generation) return;
      selections.clear(); $('#batch-review-form').reset(); $('#batch-apply-status').hidden = true;
      submitting = false;
      const completion = `已提交 ${result.count} 篇文章的审核，发布 ${result.publishedCount} 篇。${result.publishedCount ? '可前往本站读者页查看。' : ''}`;
      message(completion);
      try { await load(); } catch (error) {
        if (error.code !== 'STALE_RESPONSE') message(`${completion}列表刷新未完成，请使用顶部刷新按钮重新读取。`, 'error');
      }
    } catch (error) {
      if (error.code === 'CONFLICT') message('文章修订、版本或审核记录已变化，本次整批未保存或发布。请刷新并重新核对后提交。', 'error');
      else errorMessage(error);
    } finally {
      if (current === generation) { submitting = false; updateControls(); }
    }
  });

  return { clear, load, snapshot };
}
