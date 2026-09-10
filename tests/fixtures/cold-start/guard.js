// Runs before app.js. Rewrite external anchors so normal clicks, keyboard use and
// context-menu opens all remain in the local preview, including fixture permalinks.
const explain = () => {
  const notice = document.getElementById('cold-start-preview-notice');
  if (notice) {
    notice.textContent = '【测试样例】外部链接与发布已停用。你仍可浏览样例、展开回复，并在本页演练输入。';
    notice.focus();
  }
};
const external = link => {
  try { return new URL(link.getAttribute('href'), location.href).origin !== location.origin; }
  catch { return true; }
};
const protect = () => {
  for (const link of document.querySelectorAll('a[href]')) {
    if (!external(link)) continue;
    link.href = '#cold-start-preview-notice';
    link.removeAttribute('target');
    link.dataset.coldStartBlocked = 'true';
    link.title = '仅测试：外部访问已停用';
  }
};
for (const eventType of ['click', 'auxclick']) document.addEventListener(eventType, event => {
  const link = event.target.closest?.('a[href]');
  if (!link || (!link.dataset.coldStartBlocked && !external(link))) return;
  event.preventDefault(); event.stopImmediatePropagation(); explain();
}, true);
new MutationObserver(protect).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
document.addEventListener('DOMContentLoaded', protect, { once: true });
