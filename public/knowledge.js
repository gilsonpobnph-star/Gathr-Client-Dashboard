/* ── Knowledge Base ────────────────────────────────────────────────────────
   Business facts and SOPs typed straight into the CRM so the app's AI
   features (starting with Diagnostic's AI recommendations) can pull from
   them instead of relying on hardcoded assumptions or a Drive export.
   Self-contained IIFE, own persistence via /api/knowledge/*, same isolation
   pattern as diagnostic.js and growth.js. */
(function () {
  let docs = [];
  let activeFilter = '';

  const $ = id => document.getElementById('kb-' + id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const htmlToText = html => String(html || '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

  async function apiGet(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiSend(url, method, body) {
    try { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }

  const CATEGORY_LABEL = { services: 'Services', sops: 'SOPs', brand: 'Brand', other: 'Other' };

  async function onOpen() {
    const list = await apiGet('/api/knowledge/docs');
    docs = list || [];
    wireFilters();
    render();
  }

  function wireFilters() {
    document.querySelectorAll('#tab-knowledge .kb-filter-chip').forEach(btn => {
      btn.onclick = () => {
        activeFilter = btn.dataset.cat || '';
        document.querySelectorAll('#tab-knowledge .kb-filter-chip').forEach(b => b.classList.toggle('active', b === btn));
        render();
      };
    });
  }

  function render() {
    const listEl = $('list'), emptyEl = $('empty');
    const filtered = activeFilter ? docs.filter(d => d.category === activeFilter) : docs;
    if (!filtered.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.querySelector('p').textContent = docs.length
        ? 'No docs in this category yet.'
        : 'No docs yet. Add a service sheet, an SOP, or a brand-voice note to get started.';
      return;
    }
    emptyEl.classList.add('hidden');
    listEl.innerHTML = filtered.map(d => {
      const preview = htmlToText(d.content).slice(0, 220);
      return `
      <div class="kb-card">
        <div class="kb-card-head">
          <div>
            <span class="kb-cat-badge kb-cat-${esc(d.category)}">${esc(CATEGORY_LABEL[d.category] || d.category)}</span>
            ${d.alwaysInclude ? '<span class="kb-cat-badge kb-cat-always">Always included</span>' : ''}
            <h3 class="kb-card-title">${esc(d.title)}</h3>
          </div>
          <div class="kb-card-actions">
            <button class="btn-secondary" onclick="KnowledgeBase.showEdit('${d.id}')">Edit</button>
            <button class="btn-secondary" onclick="KnowledgeBase.remove('${d.id}')">Delete</button>
          </div>
        </div>
        ${d.tags ? `<div class="kb-card-tags">${esc(d.tags).split(',').map(t => t.trim()).filter(Boolean).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <p class="kb-card-preview">${esc(preview)}${htmlToText(d.content).length > 220 ? '…' : ''}</p>
      </div>
    `;
    }).join('');
  }

  function showAdd() {
    $('modal-title').textContent = 'Add doc';
    $('f-id').value = '';
    $('f-title').value = '';
    $('f-category').value = 'other';
    $('f-tags').value = '';
    $('f-always').checked = false;
    $('f-content').innerHTML = '';
    $('modal').classList.remove('hidden');
  }

  function showEdit(id) {
    const d = docs.find(x => x.id === id);
    if (!d) return;
    $('modal-title').textContent = 'Edit doc';
    $('f-id').value = d.id;
    $('f-title').value = d.title;
    $('f-category').value = d.category;
    $('f-tags').value = d.tags || '';
    $('f-always').checked = !!d.alwaysInclude;
    $('f-content').innerHTML = d.content || '';
    $('modal').classList.remove('hidden');
  }

  function closeModal() { $('modal').classList.add('hidden'); }

  // Rich-text toolbar — deliberately simple (execCommand) since this is an
  // internal, admin-only editor, not a public-facing WYSIWYG product.
  function cmd(name, value) {
    $('content').focus();
    document.execCommand(name, false, value || null);
  }
  function titleCase() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { toast('Select some text first'); return; }
    const text = sel.toString();
    const cased = text.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    document.execCommand('insertText', false, cased);
  }

  async function save() {
    const id = $('f-id').value;
    const content = $('f-content').innerHTML;
    const body = {
      title: $('f-title').value.trim() || 'Untitled',
      category: $('f-category').value,
      tags: $('f-tags').value.trim(),
      alwaysInclude: $('f-always').checked,
      content,
    };
    if (!htmlToText(content)) { toast('Add some content first'); return; }
    const result = id ? await apiSend(`/api/knowledge/docs/${id}`, 'PUT', body) : await apiSend('/api/knowledge/docs', 'POST', body);
    if (!result) { toast('Could not save doc'); return; }
    closeModal();
    toast(id ? 'Doc updated.' : 'Doc added.');
    await onOpen();
  }

  async function remove(id) {
    if (!confirm('Delete this doc? This cannot be undone.')) return;
    const result = await apiSend(`/api/knowledge/docs/${id}`, 'DELETE', {});
    if (!result) { toast('Could not delete doc'); return; }
    toast('Doc deleted.');
    await onOpen();
  }

  window.KnowledgeBase = { onOpen, showAdd, showEdit, closeModal, save, remove, cmd, titleCase };
})();
