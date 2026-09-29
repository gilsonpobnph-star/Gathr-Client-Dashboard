/* ── Projects & Tasks (My Dashboard) ──────────────────────────────────────────
   Rebuilt per the GilBridge HQ handoff: clients → projects → tasks → one-
   level subtasks, configurable statuses/priorities, custom fields, time
   tracking, and three views (List / Board / Client Health) all sharing one
   toolbar. Mounted inside the existing "My Dashboard" tab, below its KPI row.

   taskConfig / projects / timeEntries are kept as true top-level bindings
   (outside the IIFE below), not tucked inside window.ProjectsTasks, so
   app.js's task modal (openTaskModal, saveTask, the timer) can read them
   directly as bare identifiers — the same cross-script sharing this app
   already relies on elsewhere (e.g. growth.js reading app.js's `clients`).
   Everything else stays inside the closure and is reached only through
   window.ProjectsTasks, same convention as Growth/Diagnostic/Knowledge. */
let taskConfig = { statuses: ['To Do', 'In Progress', 'Done'], priorities: ['Low', 'Medium', 'High'], columns: [] };
let projects = [];
let timeEntries = [];

(function () {
  let activeSubTab = 'list';
  let toolbarClientId = '';
  let toolbarProjectId = '';
  let toolbarAssignee = '';
  let toolbarStatus = '';
  let toolbarPriority = '';
  let toolbarDueBucket = '';
  let toolbarSearch = '';
  let hideDone = false;
  let sortField = 'due'; // 'due' | 'title' | 'status' | 'priority'
  let sortDir = 'asc';
  let myClientsCache = [];
  let collapsedSections = {}; // UI-only, not persisted
  let editingProjectId = null;
  let editingProjectPresetClientId = '';

  const esc = s => (window.escHtml ? escHtml(s) : String(s ?? ''));

  async function apiGet(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiSend(url, method, body) {
    try { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }

  async function loadConfig() { const c = await apiGet('/api/task-config'); if (c) taskConfig = c; }
  async function loadProjects() { const p = await apiGet('/api/projects'); if (p) projects = p; }
  async function loadTimeEntries() { const t = await apiGet('/api/time-entries'); if (t) timeEntries = t; }

  /* ── Mount / lifecycle ─────────────────────────────────────────────────── */
  async function onOpen(myClients) {
    myClientsCache = myClients || myClientsCache;
    const root = document.getElementById('projects-tasks-root');
    if (!root) return;
    if (!root.dataset.mounted) {
      root.innerHTML = shellHtml();
      root.dataset.mounted = '1';
      wireToolbar();
    }
    await Promise.all([loadConfig(), loadProjects(), loadTimeEntries()]);
    populateStatusPriorityFilters();
    render();
  }
  function refresh() {
    if (!document.getElementById('projects-tasks-root')?.dataset.mounted) return;
    render();
  }

  function shellHtml() {
    return `
      <div class="pt-subtabs">
        <button class="pt-subtab active" data-sub="list" onclick="ProjectsTasks.switchSubTab('list')">List</button>
        <button class="pt-subtab" data-sub="board" onclick="ProjectsTasks.switchSubTab('board')">Board</button>
        <button class="pt-subtab" data-sub="health" onclick="ProjectsTasks.switchSubTab('health')">Client Health</button>
      </div>
      <div class="pt-toolbar">
        <select id="pt-filter-client" class="inline-select"><option value="">All clients</option></select>
        <select id="pt-filter-project" class="inline-select"><option value="">All projects</option></select>
        <select id="pt-filter-assignee" class="inline-select"><option value="">Everyone's tasks</option></select>
        <select id="pt-filter-status" class="inline-select"><option value="">All statuses</option></select>
        <select id="pt-filter-priority" class="inline-select"><option value="">All priorities</option></select>
        <select id="pt-filter-due" class="inline-select">
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
        </select>
        <input id="pt-filter-search" class="pt-search" placeholder="Search tasks…">
        <label class="pt-hide-done"><input type="checkbox" id="pt-hide-done"> Hide done</label>
        <div class="pt-toolbar-spacer"></div>
        <button id="btn-toggle-archived" class="btn-toggle-archived" onclick="toggleArchivedTasks()">Archived</button>
        <button class="btn-view" style="font-size:12px;padding:6px 14px" onclick="ProjectsTasks.openFieldsManager()">Fields</button>
        <button class="btn-view" style="font-size:12px;padding:6px 14px" onclick="ProjectsTasks.openProjectModal()">+ Project</button>
        <button class="btn-primary" style="font-size:12px;padding:6px 14px" onclick="openTaskModal()">+ Task</button>
      </div>
      <div id="pt-list-col-header" class="pt-task-row pt-task-col-header"></div>
      <div id="pt-view-list" class="pt-view"></div>
      <div id="pt-view-board" class="pt-view hidden"></div>
      <div id="pt-view-health" class="pt-view hidden"></div>
    `;
  }

  function wireToolbar() {
    const clientSel = document.getElementById('pt-filter-client');
    clientSel.innerHTML = '<option value="">All clients</option>' +
      clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    clientSel.onchange = () => { toolbarClientId = clientSel.value; toolbarProjectId = ''; refreshProjectFilterOptions(); render(); };
    document.getElementById('pt-filter-project').onchange = e => { toolbarProjectId = e.target.value; render(); };
    document.getElementById('pt-filter-search').oninput = e => { toolbarSearch = e.target.value.toLowerCase(); render(); };
    document.getElementById('pt-hide-done').onchange = e => { hideDone = e.target.checked; render(); };

    const assigneeSel = document.getElementById('pt-filter-assignee');
    const myName = currentUser.name || '';
    const everyone = [...new Set([...team, myName])].filter(Boolean);
    assigneeSel.innerHTML = '<option value="">Everyone\'s tasks</option>' +
      '<option value="__unassigned__">Unassigned</option>' +
      everyone.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    assigneeSel.onchange = () => { toolbarAssignee = assigneeSel.value; render(); };

    document.getElementById('pt-filter-status').onchange = e => { toolbarStatus = e.target.value; render(); };
    document.getElementById('pt-filter-priority').onchange = e => { toolbarPriority = e.target.value; render(); };
    document.getElementById('pt-filter-due').onchange = e => { toolbarDueBucket = e.target.value; render(); };
  }
  // Status/priority options come from taskConfig, which loads async after
  // the toolbar's first mount — call again whenever taskConfig changes
  // (initial load, and after the Fields manager saves).
  function populateStatusPriorityFilters() {
    const statusSel = document.getElementById('pt-filter-status');
    const prioritySel = document.getElementById('pt-filter-priority');
    if (!statusSel || !prioritySel) return;
    const keepIfValid = (sel, current, options) => options.includes(current) ? current : '';
    statusSel.innerHTML = '<option value="">All statuses</option>' + taskConfig.statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    prioritySel.innerHTML = '<option value="">All priorities</option>' + taskConfig.priorities.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    toolbarStatus = keepIfValid(statusSel, toolbarStatus, taskConfig.statuses);
    toolbarPriority = keepIfValid(prioritySel, toolbarPriority, taskConfig.priorities);
    statusSel.value = toolbarStatus;
    prioritySel.value = toolbarPriority;
  }
  function matchesAssignee(t) {
    if (!toolbarAssignee) return true;
    if (toolbarAssignee === '__unassigned__') return !(t.assignedTo || []).length;
    return (t.assignedTo || []).includes(toolbarAssignee);
  }
  function matchesDueBucket(t) {
    if (!toolbarDueBucket) return true;
    if (toolbarDueBucket === 'none') return !t.deadline;
    if (!t.deadline) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dl = new Date(t.deadline + 'T00:00');
    if (toolbarDueBucket === 'overdue') return dl < today && !t.done;
    if (toolbarDueBucket === 'week') { const weekOut = new Date(today.getTime() + 7 * 86400000); return dl >= today && dl <= weekOut; }
    return true;
  }
  function refreshProjectFilterOptions() {
    const sel = document.getElementById('pt-filter-project');
    const scoped = toolbarClientId ? projects.filter(p => p.clientId === toolbarClientId) : projects;
    sel.innerHTML = '<option value="">All projects</option>' + scoped.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  function switchSubTab(tab) {
    activeSubTab = tab;
    document.querySelectorAll('.pt-subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === tab));
    document.getElementById('pt-view-list').classList.toggle('hidden', tab !== 'list');
    document.getElementById('pt-view-board').classList.toggle('hidden', tab !== 'board');
    document.getElementById('pt-view-health').classList.toggle('hidden', tab !== 'health');
    // Project filter doesn't apply to Client Health, which is already grouped by client.
    document.getElementById('pt-filter-project').style.display = tab === 'health' ? 'none' : '';
    document.getElementById('pt-hide-done').closest('.pt-hide-done').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('pt-list-col-header').classList.toggle('hidden', tab !== 'list');
    render();
  }

  function render() {
    if (activeSubTab === 'list') { renderListColHeader(); renderList(); }
    else if (activeSubTab === 'board') renderBoard();
    else renderClientHealth();
  }

  /* ── Shared filtering ──────────────────────────────────────────────────── */
  function baseFiltered() {
    // myTasks already reflects the archived/active toggle (toggleArchivedTasks
    // swaps the whole array), so no extra archived filtering needed here.
    let list = [...myTasks];
    if (toolbarClientId) list = list.filter(t => t.clientId === toolbarClientId);
    if (toolbarProjectId) list = list.filter(t => t.projectId === toolbarProjectId);
    if (toolbarStatus) list = list.filter(t => t.status === toolbarStatus);
    if (toolbarPriority) list = list.filter(t => t.priority === toolbarPriority);
    if (toolbarSearch) list = list.filter(t => (t.title || '').toLowerCase().includes(toolbarSearch));
    list = list.filter(matchesAssignee);
    list = list.filter(matchesDueBucket);
    return list;
  }
  function sortTasks(list) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let av, bv;
      if (sortField === 'due')            { av = a.deadline || '9999-99-99'; bv = b.deadline || '9999-99-99'; }
      else if (sortField === 'priority')  { av = taskConfig.priorities.indexOf(a.priority); bv = taskConfig.priorities.indexOf(b.priority); }
      else if (sortField === 'status')    { av = taskConfig.statuses.indexOf(a.status); bv = taskConfig.statuses.indexOf(b.status); }
      else                                 { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  function setSort(field) {
    if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortField = field; sortDir = 'asc'; }
    renderListColHeader();
    render();
  }
  function sortArrow(field) { return sortField === field ? (sortDir === 'asc' ? ' &#9650;' : ' &#9660;') : ''; }
  function renderListColHeader() {
    const el = document.getElementById('pt-list-col-header');
    if (!el) return;
    el.innerHTML = `
      <span></span>
      <span class="pt-sort-h" onclick="ProjectsTasks.setSort('title')">Task${sortArrow('title')}</span>
      <span class="pt-sort-h" onclick="ProjectsTasks.setSort('status')">Status${sortArrow('status')}</span>
      <span class="pt-sort-h" onclick="ProjectsTasks.setSort('priority')">Priority${sortArrow('priority')}</span>
      <span class="pt-sort-h" onclick="ProjectsTasks.setSort('due')">Due${sortArrow('due')}</span>
      <span>Time</span>
      <span></span>
      <span></span>
    `;
  }
  function priorityColor(name) {
    const idx = taskConfig.priorities.indexOf(name);
    const n = Math.max(1, taskConfig.priorities.length - 1);
    const pct = idx < 0 ? 0.5 : idx / n;
    if (pct < 0.34) return '#3D74A6';
    if (pct < 0.67) return '#B4791F';
    return '#E05B2E';
  }
  function isOverdue(t) { return t.deadline && !t.done && t.deadline < new Date().toISOString().slice(0, 10); }
  function dueLabel(t) {
    if (!t.deadline) return { label: '—', color: 'var(--text3)' };
    if (t.done) return { label: '✓ Done', color: 'var(--green)' };
    const today = new Date().toISOString().slice(0, 10);
    if (t.deadline < today) return { label: 'Overdue', color: '#ef4444' };
    if (t.deadline === today) return { label: 'Due today', color: '#f97316' };
    return { label: new Date(t.deadline + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), color: 'var(--text3)' };
  }

  /* ── List view ─────────────────────────────────────────────────────────── */
  function renderList() {
    const el = document.getElementById('pt-view-list');
    if (!el) return;
    let list = baseFiltered().filter(t => !t.parentId); // sections show top-level tasks + their subtasks inline
    if (hideDone) list = list.filter(t => !t.done);

    // byClient[clientId][projectId] -> tasks[]. Seeded from tasks first...
    const byClient = {};
    list.forEach(t => {
      const cid = t.clientId || '';
      byClient[cid] = byClient[cid] || {};
      const pid = t.projectId || '';
      (byClient[cid][pid] = byClient[cid][pid] || []).push(t);
    });

    // ...then every project matching the current filters gets its own
    // (possibly empty) bucket too — otherwise a brand-new project with no
    // tasks yet is invisible, which is exactly what happened here: the
    // project existed but nothing showed until a task was added under it.
    let projectsToShow = projects;
    if (toolbarClientId) projectsToShow = projectsToShow.filter(p => p.clientId === toolbarClientId);
    if (toolbarProjectId) projectsToShow = projectsToShow.filter(p => p.id === toolbarProjectId);
    projectsToShow.forEach(p => {
      byClient[p.clientId] = byClient[p.clientId] || {};
      byClient[p.clientId][p.id] = byClient[p.clientId][p.id] || [];
    });

    const clientIds = Object.keys(byClient);
    if (!clientIds.length) { el.innerHTML = '<div class="task-empty">No tasks or projects match — hit <strong>+ Task</strong> or <strong>+ Project</strong> to get started.</div>'; return; }

    el.innerHTML = clientIds.map(cid => {
      const client = clients.find(c => c.id === cid);
      const clientName = client ? esc(client.name) : 'No client';
      const byProject = byClient[cid];
      const projIds = Object.keys(byProject).sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));

      return `<div class="pt-client-block">
        <div class="pt-client-block-title">${clientName}</div>
        ${projIds.map(pid => projectSectionHtml(cid, pid, byProject[pid])).join('')}
      </div>`;
    }).join('');
  }

  function projectSectionHtml(clientId, projectId, tasksInSection) {
    const project = projectId ? projects.find(p => p.id === projectId) : null;
    const key = clientId + '::' + projectId;
    const collapsed = !!collapsedSections[key];
    const doneCount = tasksInSection.filter(t => t.done).length;
    const pct = tasksInSection.length ? Math.round((doneCount / tasksInSection.length) * 100) : 0;
    const overdueProject = project && project.due && project.status !== 'done' && project.due < new Date().toISOString().slice(0, 10);

    return `<div class="pt-project-section">
      <div class="pt-project-header" onclick="ProjectsTasks.toggleSection('${key}')">
        <span class="pt-collapse-caret">${collapsed ? '▸' : '▾'}</span>
        <span class="pt-project-name">${project ? esc(project.name) : 'Uncategorized'}</span>
        ${project ? `<span class="pt-project-status-pill">${esc(project.status)}</span>` : ''}
        <span class="pt-project-count">${doneCount}/${tasksInSection.length} done</span>
        <div class="pt-project-bar-track"><div class="pt-project-bar-fill" style="width:${pct}%"></div></div>
        ${project?.due ? `<span class="pt-project-due" style="color:${overdueProject ? '#ef4444' : 'var(--text3)'}">${esc(project.due)}</span>` : ''}
        ${project ? `<button class="tda-link-btn" onclick="event.stopPropagation();ProjectsTasks.openProjectModal('${project.id}')">Edit</button>` : ''}
      </div>
      ${collapsed ? '' : `<div class="pt-task-table">
        ${sortTasks(tasksInSection).map(t => taskRowHtml(t)).join('')}
        <div class="pt-quick-add">
          <input placeholder="Add a task… (Enter)" onkeydown="if(event.key==='Enter'){event.preventDefault();ProjectsTasks.quickAdd(this,'${clientId}','${projectId}')}">
        </div>
      </div>`}
    </div>`;
  }

  function taskRowHtml(t) {
    const subs = myTasks.filter(s => s.parentId === t.id);
    const visibleSubs = hideDone ? subs.filter(s => !s.done) : subs;
    const row = (task, indent) => {
      const secs = timeEntries.filter(e => e.taskId === task.id).reduce((s, e) => s + (e.secs || 0), 0);
      const running = typeof activeTimer !== 'undefined' && activeTimer && activeTimer.taskId === task.id;
      return `<div class="pt-task-row${indent ? ' pt-task-row-sub' : ''}">
        <input type="checkbox" ${task.done ? 'checked' : ''} onchange="ProjectsTasks.quickToggleDone('${task.id}', this.checked)">
        <span class="pt-task-title" onclick="openTaskModal('${task.id}')">${esc(task.title)}</span>
        <select class="pt-inline-select" onchange="ProjectsTasks.quickSetField('${task.id}','status',this.value)">${taskConfig.statuses.map(s => `<option value="${esc(s)}" ${task.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select>
        <select class="pt-inline-select" onchange="ProjectsTasks.quickSetField('${task.id}','priority',this.value)">${taskConfig.priorities.map(p => `<option value="${esc(p)}" ${task.priority===p?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <input type="date" class="pt-inline-select" value="${task.deadline||''}" onchange="ProjectsTasks.quickSetField('${task.id}','deadline',this.value)">
        <span class="pt-task-time">${fmtDuration(secs)}</span>
        <button class="pt-timer-btn ${running ? 'running' : ''}" onclick="toggleTaskTimer('${task.id}')" title="Start/stop timer">⏱</button>
        <button class="tda-link-btn" onclick="ProjectsTasks.quickDelete('${task.id}')">delete</button>
      </div>`;
    };
    return row(t, false) + visibleSubs.map(s => row(s, true)).join('');
  }

  async function quickAdd(input, clientId, projectId) {
    const title = input.value.trim();
    if (!title) return;
    const saved = await apiSend('/api/tasks', 'POST', { title, clientId: clientId || '', projectId: projectId || '', status: taskConfig.statuses[0], priority: taskConfig.priorities[0] });
    if (!saved) return;
    myTasks.push(saved);
    input.value = '';
    render();
  }
  async function quickToggleDone(id, checked) {
    const saved = await apiSend(`/api/tasks/${id}`, 'PATCH', { done: checked });
    if (!saved) return;
    const idx = myTasks.findIndex(x => x.id === id);
    if (idx !== -1) myTasks[idx] = saved;
    render();
  }
  async function quickSetField(id, field, value) {
    const saved = await apiSend(`/api/tasks/${id}`, 'PATCH', { [field]: value });
    if (!saved) return;
    const idx = myTasks.findIndex(x => x.id === id);
    if (idx !== -1) myTasks[idx] = saved;
    render();
  }
  async function quickDelete(id) {
    if (!confirm('Delete this task?')) return;
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    myTasks = myTasks.filter(x => x.id !== id && x.parentId !== id);
    render();
  }
  function toggleSection(key) { collapsedSections[key] = !collapsedSections[key]; renderList(); }

  /* ── Board view ────────────────────────────────────────────────────────── */
  function renderBoard() {
    const el = document.getElementById('pt-view-board');
    if (!el) return;
    let list = baseFiltered().filter(t => !t.parentId);
    if (hideDone) list = list.filter(t => !t.done);

    el.innerHTML = `<div class="pt-board">${taskConfig.statuses.map(status => {
      const cardsForCol = list.filter(t => t.status === status);
      return `<div class="pt-board-col" ondragover="event.preventDefault()" ondrop="ProjectsTasks.boardDrop(event,'${esc(status)}')">
        <div class="pt-board-col-header">
          <span>${esc(status)}</span>
          <span class="pt-board-col-count">${cardsForCol.length}</span>
          <button class="pt-board-add" onclick="ProjectsTasks.boardQuickAdd('${esc(status)}')">+</button>
        </div>
        <div class="pt-board-col-body">
          ${cardsForCol.map(t => boardCardHtml(t)).join('')}
        </div>
      </div>`;
    }).join('')}</div>`;
  }
  function boardCardHtml(t) {
    const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
    const project = t.projectId ? projects.find(p => p.id === t.projectId) : null;
    const subs = myTasks.filter(s => s.parentId === t.id);
    const doneSubs = subs.filter(s => s.done).length;
    const dl = dueLabel(t);
    return `<div class="pt-board-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${t.id}')" onclick="openTaskModal('${t.id}')">
      <div class="pt-board-card-top">
        <span class="pt-priority-dot" style="background:${priorityColor(t.priority)}"></span>
        <span>${esc(t.priority)}</span>
      </div>
      <div class="pt-board-card-title">${esc(t.title)}</div>
      ${(client || project) ? `<div class="pt-board-card-meta">${client ? esc(client.name) : ''}${client && project ? ' / ' : ''}${project ? esc(project.name) : ''}</div>` : ''}
      <div class="pt-board-card-bottom">
        ${t.deadline ? `<span style="color:${isOverdue(t) ? '#ef4444' : 'var(--text3)'}">${esc(dl.label)}</span>` : ''}
        ${subs.length ? `<span class="pt-board-badge">${doneSubs}/${subs.length}</span>` : ''}
        ${(t.comments||[]).length ? `<span class="pt-board-badge">💬 ${t.comments.length}</span>` : ''}
      </div>
    </div>`;
  }
  async function boardDrop(ev, status) {
    const id = ev.dataTransfer.getData('text/plain');
    if (!id) return;
    const saved = await apiSend(`/api/tasks/${id}`, 'PATCH', { status });
    if (!saved) return;
    const idx = myTasks.findIndex(x => x.id === id);
    if (idx !== -1) myTasks[idx] = saved;
    render();
  }
  async function boardQuickAdd(status) {
    const title = prompt('Task title:');
    if (!title?.trim()) return;
    const saved = await apiSend('/api/tasks', 'POST', { title: title.trim(), status, clientId: toolbarClientId || '', projectId: toolbarProjectId || '' });
    if (!saved) return;
    myTasks.push(saved);
    render();
  }

  /* ── Client Health view ────────────────────────────────────────────────── */
  function matchesSharedFilters(t) {
    if (toolbarStatus && t.status !== toolbarStatus) return false;
    if (toolbarPriority && t.priority !== toolbarPriority) return false;
    if (!matchesAssignee(t)) return false;
    if (!matchesDueBucket(t)) return false;
    return true;
  }
  function clientOpenTasks(clientId) { return myTasks.filter(t => t.clientId === clientId && !t.parentId && !t.done).filter(matchesSharedFilters); }
  function clientAllTasks(clientId)  { return myTasks.filter(t => t.clientId === clientId && !t.parentId).filter(matchesSharedFilters); }

  function renderClientHealth() {
    const el = document.getElementById('pt-view-health');
    if (!el) return;
    const candidateClients = (toolbarClientId ? clients.filter(c => c.id === toolbarClientId) : clients)
      .filter(c => clientAllTasks(c.id).length || projects.some(p => p.clientId === c.id));

    if (!candidateClients.length) { el.innerHTML = '<div class="task-empty">No clients with projects or tasks yet.</div>'; return; }

    el.innerHTML = `<div class="pt-health-grid">${candidateClients.map(c => clientHealthCardHtml(c)).join('')}</div>`;
    candidateClients.forEach(c => paintClientCharts(c));
  }

  function clientHealthCardHtml(c) {
    const all = clientAllTasks(c.id);
    const open = all.filter(t => !t.done);
    const overdue = open.filter(t => isOverdue(t));
    const today = new Date(); today.setHours(0,0,0,0);
    const weekOut = new Date(today.getTime() + 7 * 86400000);
    const dueThisWeek = open.filter(t => t.deadline && new Date(t.deadline) >= today && new Date(t.deadline) <= weekOut);
    const completed = all.filter(t => t.done);
    const completedWithDue = completed.filter(t => t.deadline);
    const onTime = completedWithDue.filter(t => t.completedAt && t.completedAt.slice(0,10) <= t.deadline);
    const onTimeRate = completedWithDue.length ? Math.round((onTime.length / completedWithDue.length) * 100) : null;

    let health = 'No tasks', healthClass = 'pt-health-none';
    if (open.length) {
      const overduePct = overdue.length / open.length;
      if (!overdue.length) { health = 'On track'; healthClass = 'pt-health-ok'; }
      else if (overduePct <= 0.2) { health = 'Watch'; healthClass = 'pt-health-watch'; }
      else { health = 'At risk'; healthClass = 'pt-health-risk'; }
    }

    const clientProjects = projects.filter(p => p.clientId === c.id);
    const paceRows = clientProjects.map(p => {
      const projTasks = all.filter(t => t.projectId === p.id);
      const donePct = projTasks.length ? (projTasks.filter(t => t.done).length / projTasks.length) * 100 : 0;
      let elapsedPct = 0;
      if (p.start && p.due) {
        const s = new Date(p.start), d = new Date(p.due), n = new Date();
        elapsedPct = d > s ? Math.min(100, Math.max(0, ((n - s) / (d - s)) * 100)) : 0;
      }
      const pastDeadline = p.due && p.due < new Date().toISOString().slice(0,10) && p.status !== 'done';
      let paceLabel = 'On pace', paceClass = 'pt-pace-ok';
      if (pastDeadline) { paceLabel = 'Past deadline'; paceClass = 'pt-pace-bad'; }
      else if (donePct < elapsedPct - 15) { paceLabel = 'Behind pace'; paceClass = 'pt-pace-bad'; }
      return `<div class="pt-pace-row">
        <span class="pt-pace-name">${esc(p.name)}</span>
        <span class="pt-pace-pct">${Math.round(donePct)}% done · ${Math.round(elapsedPct)}% elapsed</span>
        <span class="pt-pace-badge ${paceClass}">${paceLabel}</span>
      </div>`;
    }).join('') || '<div style="color:var(--text3);font-size:12px">No projects yet.</div>';

    const top6 = [...open].sort((a, b) => {
      const pr = taskConfig.priorities.indexOf(b.priority) - taskConfig.priorities.indexOf(a.priority);
      if (pr) return pr;
      return (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1;
    }).slice(0, 6);

    return `<div class="pt-health-card">
      <div class="pt-health-card-header">
        <div class="pt-health-card-name">${esc(c.name)}</div>
        <span class="pt-health-badge ${healthClass}">${health}</span>
      </div>
      <div class="pt-health-kpis">
        <div><span class="pt-health-kpi-val">${open.length}</span><span class="pt-health-kpi-label">Open</span></div>
        <div><span class="pt-health-kpi-val" style="color:${overdue.length?'#ef4444':'inherit'}">${overdue.length}</span><span class="pt-health-kpi-label">Overdue</span></div>
        <div><span class="pt-health-kpi-val">${dueThisWeek.length}</span><span class="pt-health-kpi-label">Due this week</span></div>
        <div><span class="pt-health-kpi-val">${completed.length}</span><span class="pt-health-kpi-label">Completed</span></div>
        <div><span class="pt-health-kpi-val">${onTimeRate==null?'—':onTimeRate+'%'}</span><span class="pt-health-kpi-label">On-time rate</span></div>
      </div>
      <div class="pt-pace-list">${paceRows}</div>
      <div class="pt-health-charts">
        <canvas id="pt-chart-status-${c.id}" height="140"></canvas>
        <canvas id="pt-chart-priority-${c.id}" height="140"></canvas>
      </div>
      <div class="pt-health-next">
        <div class="pt-field-label">What to do first</div>
        ${top6.length ? top6.map(t => `<div class="pt-next-row" onclick="openTaskModal('${t.id}')">
          <span class="pt-priority-dot" style="background:${priorityColor(t.priority)}"></span>
          <span class="pt-next-title">${esc(t.title)}</span>
          <span class="pt-next-due" style="color:${isOverdue(t)?'#ef4444':'var(--text3)'}">${esc(dueLabel(t).label)}</span>
        </div>`).join('') : '<div style="color:var(--text3);font-size:12px">Nothing open — nice work.</div>'}
      </div>
    </div>`;
  }

  function statusChartDataForClient(c) {
    const all = clientAllTasks(c.id);
    const counts = taskConfig.statuses.map(s => all.filter(t => t.status === s).length);
    return { labels: taskConfig.statuses, datasets: [{ data: counts, backgroundColor: ['#3D74A6','#B4791F','#4A8B62','#7E58AD'], borderWidth: 0 }] };
  }
  function priorityChartDataForClient(c) {
    const open = clientOpenTasks(c.id);
    const counts = taskConfig.priorities.map(p => open.filter(t => t.priority === p).length);
    return { labels: taskConfig.priorities, datasets: [{ label: 'Open tasks', data: counts, backgroundColor: taskConfig.priorities.map(p => priorityColor(p)), borderWidth: 0 }] };
  }
  function paintClientCharts(c) {
    if (typeof renderChart !== 'function') return;
    renderChart(`pt-chart-status-${c.id}`, 'doughnut', statusChartDataForClient(c));
    renderChart(`pt-chart-priority-${c.id}`, 'bar', priorityChartDataForClient(c));
    // Flip the priority bar horizontal after render() (renderChart doesn't
    // expose a per-call options override).
    const barChart = charts[`pt-chart-priority-${c.id}`];
    if (barChart) { barChart.options.indexAxis = 'y'; barChart.update(); }
  }

  /* ── Project modal ─────────────────────────────────────────────────────── */
  function openProjectModal(projectId, presetClientId) {
    editingProjectId = projectId || null;
    editingProjectPresetClientId = presetClientId || '';
    const p = projectId ? projects.find(x => x.id === projectId) : null;
    let modal = document.getElementById('pt-project-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pt-project-modal';
      modal.className = 'modal-overlay hidden';
      modal.onclick = e => { if (e.target === modal) closeProjectModal(); };
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<div class="modal" style="max-width:480px;padding:0">
      <button class="modal-close" onclick="ProjectsTasks.closeProjectModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="pt-modal-header">
        <span class="dash-card-dot" style="background:var(--accent)"></span>
        <h3>${p ? 'Edit project' : 'New project'}</h3>
      </div>
      <div class="pt-modal-body">
        <div class="pt-modal-field">
          <label>Name</label>
          <input id="pj-name" class="pt-modal-input" placeholder="e.g. Website refresh" value="${esc(p?.name||'')}">
        </div>
        <div class="pt-modal-field">
          <label>Client</label>
          <select id="pj-client" class="pt-modal-input">${clients.map(c => `<option value="${c.id}" ${(p?.clientId||presetClientId)===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="pt-modal-row">
          <div class="pt-modal-field">
            <label>Status</label>
            <select id="pj-status" class="pt-modal-input">
              ${['planned','in progress','on hold','done'].map(s => `<option value="${s}" ${(p?.status||'planned')===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="pt-modal-field">
            <label>Start</label>
            <input id="pj-start" type="date" class="pt-modal-input" value="${p?.start||''}">
          </div>
          <div class="pt-modal-field">
            <label>Due</label>
            <input id="pj-due" type="date" class="pt-modal-input" value="${p?.due||''}">
          </div>
        </div>
        <div class="pt-modal-field">
          <label>Notes</label>
          <textarea id="pj-notes" class="pt-modal-input" rows="3" placeholder="Optional context…">${esc(p?.notes||'')}</textarea>
        </div>
      </div>
      <div class="pt-modal-footer">
        <button class="btn-primary" onclick="ProjectsTasks.saveProject()">Save project</button>
        ${p ? `<button class="tdp-delete-btn" onclick="ProjectsTasks.deleteProject()">Delete project</button>` : ''}
      </div>
    </div>`;
    modal.classList.remove('hidden');
  }
  function closeProjectModal() { document.getElementById('pt-project-modal')?.classList.add('hidden'); }
  async function saveProject() {
    const name = document.getElementById('pj-name').value.trim();
    if (!name) { alert('Please enter a project name.'); document.getElementById('pj-name').focus(); return; }
    const payload = {
      name,
      clientId: document.getElementById('pj-client').value,
      status: document.getElementById('pj-status').value,
      start: document.getElementById('pj-start').value,
      due: document.getElementById('pj-due').value,
      notes: document.getElementById('pj-notes').value,
    };
    const url    = editingProjectId ? `/api/projects/${editingProjectId}` : '/api/projects';
    const method = editingProjectId ? 'PATCH' : 'POST';
    // Bypass the shared apiSend() here (it swallows errors and returns null)
    // so a failed save is never silent — this is exactly what let a project
    // creation fail with zero feedback.
    let res, saved;
    try {
      res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      saved = await res.json();
    } catch (e) {
      alert('Could not save project — network error. Please try again.');
      return;
    }
    if (!res.ok) {
      alert(`Could not save project: ${saved?.error || res.status}`);
      return;
    }
    const idx = projects.findIndex(p => p.id === saved.id);
    if (idx !== -1) projects[idx] = saved; else projects.push(saved);
    closeProjectModal();
    render();
  }
  async function deleteProject() {
    if (!editingProjectId || !confirm('Delete this project? Its tasks move to "Uncategorized".')) return;
    const res = await fetch(`/api/projects/${editingProjectId}`, { method: 'DELETE' });
    if (!res.ok) return;
    projects = projects.filter(p => p.id !== editingProjectId);
    myTasks.forEach(t => { if (t.projectId === editingProjectId) t.projectId = ''; });
    closeProjectModal();
    render();
  }

  /* ── Fields manager (statuses / priorities / custom fields) ─────────────── */
  function openFieldsManager() {
    let modal = document.getElementById('pt-fields-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pt-fields-modal';
      modal.className = 'modal-overlay hidden';
      modal.onclick = e => { if (e.target === modal) closeFieldsManager(); };
      document.body.appendChild(modal);
    }
    renderFieldsManager(modal);
    modal.classList.remove('hidden');
  }
  function closeFieldsManager() { document.getElementById('pt-fields-modal')?.classList.add('hidden'); }
  function fieldsListHtml(kind, list) {
    return list.map((v, i) => `<div class="pt-fields-row">
      <input value="${esc(v)}" onchange="ProjectsTasks.renameFieldItem('${kind}',${i},this.value)">
      <button class="tda-link-btn" ${i===0?'disabled':''} onclick="ProjectsTasks.moveFieldItem('${kind}',${i},-1)">↑</button>
      <button class="tda-link-btn" ${i===list.length-1?'disabled':''} onclick="ProjectsTasks.moveFieldItem('${kind}',${i},1)">↓</button>
      <button class="tda-link-btn" onclick="ProjectsTasks.removeFieldItem('${kind}',${i})">remove</button>
      ${i===list.length-1&&kind==='statuses' ? '<span class="pt-fields-hint">= Done</span>' : ''}
    </div>`).join('');
  }
  function renderFieldsManager(modal) {
    modal.innerHTML = `<div class="modal" style="max-width:520px;max-height:80vh;overflow-y:auto;padding:24px">
      <button class="modal-close" onclick="ProjectsTasks.closeFieldsManager()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <h3 style="margin:0 0 4px">Statuses, priorities &amp; custom fields</h3>
      <p style="font-size:12px;color:var(--text3);margin:0 0 14px">Renaming won't update tasks already using the old name.</p>

      <div class="pt-field-label">Statuses (last = Done)</div>
      <div id="pt-fields-statuses">${fieldsListHtml('statuses', taskConfig.statuses)}</div>
      <div class="pt-fields-add"><input id="pt-add-status" placeholder="New status"><button class="btn-view" onclick="ProjectsTasks.addFieldItem('statuses')">Add</button></div>

      <div class="pt-field-label" style="margin-top:16px">Priorities (low → high)</div>
      <div id="pt-fields-priorities">${fieldsListHtml('priorities', taskConfig.priorities)}</div>
      <div class="pt-fields-add"><input id="pt-add-priority" placeholder="New priority"><button class="btn-view" onclick="ProjectsTasks.addFieldItem('priorities')">Add</button></div>

      <div class="pt-field-label" style="margin-top:16px">Custom fields</div>
      <div id="pt-fields-columns">${taskConfig.columns.map((col, i) => `<div class="pt-fields-row">
        <input value="${esc(col.label)}" onchange="ProjectsTasks.renameColumn(${i},this.value)">
        <select onchange="ProjectsTasks.setColumnType(${i},this.value)">
          ${['text','date','number','select','checkbox'].map(ty => `<option value="${ty}" ${col.type===ty?'selected':''}>${ty}</option>`).join('')}
        </select>
        ${col.type==='select' ? `<input placeholder="comma,separated,options" value="${esc((col.options||[]).join(','))}" onchange="ProjectsTasks.setColumnOptions(${i},this.value)">` : ''}
        <button class="tda-link-btn" onclick="ProjectsTasks.removeColumn(${i})">remove</button>
      </div>`).join('')}</div>
      <div class="pt-fields-add"><input id="pt-add-column" placeholder="New field label"><button class="btn-view" onclick="ProjectsTasks.addColumn()">Add field</button></div>

      <div style="margin-top:18px"><button class="btn-primary" onclick="ProjectsTasks.saveFieldsManager()">Save</button></div>
    </div>`;
  }
  function addFieldItem(kind) {
    const input = document.getElementById(kind === 'statuses' ? 'pt-add-status' : 'pt-add-priority');
    const v = input.value.trim();
    if (!v) return;
    taskConfig[kind].push(v);
    input.value = '';
    renderFieldsManager(document.getElementById('pt-fields-modal'));
  }
  function renameFieldItem(kind, i, v) { taskConfig[kind][i] = v; }
  function moveFieldItem(kind, i, dir) {
    const arr = taskConfig[kind];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderFieldsManager(document.getElementById('pt-fields-modal'));
  }
  function removeFieldItem(kind, i) {
    if (taskConfig[kind].length <= 1) { alert('Keep at least one.'); return; }
    taskConfig[kind].splice(i, 1);
    renderFieldsManager(document.getElementById('pt-fields-modal'));
  }
  function addColumn() {
    const input = document.getElementById('pt-add-column');
    const label = input.value.trim();
    if (!label) return;
    taskConfig.columns.push({ id: 'cf_' + Date.now().toString(36), label, type: 'text', options: [] });
    input.value = '';
    renderFieldsManager(document.getElementById('pt-fields-modal'));
  }
  function renameColumn(i, v) { taskConfig.columns[i].label = v; }
  function setColumnType(i, v) { taskConfig.columns[i].type = v; renderFieldsManager(document.getElementById('pt-fields-modal')); }
  function setColumnOptions(i, v) { taskConfig.columns[i].options = v.split(',').map(s => s.trim()).filter(Boolean); }
  function removeColumn(i) { taskConfig.columns.splice(i, 1); renderFieldsManager(document.getElementById('pt-fields-modal')); }
  async function saveFieldsManager() {
    const saved = await apiSend('/api/task-config', 'PATCH', taskConfig);
    if (saved) taskConfig = saved;
    populateStatusPriorityFilters();
    closeFieldsManager();
    render();
  }

  window.ProjectsTasks = {
    onOpen, refresh, switchSubTab, setSort,
    toggleSection, quickAdd, quickToggleDone, quickSetField, quickDelete,
    boardDrop, boardQuickAdd,
    openProjectModal, closeProjectModal, saveProject, deleteProject,
    openFieldsManager, closeFieldsManager, addFieldItem, renameFieldItem, moveFieldItem, removeFieldItem,
    addColumn, renameColumn, setColumnType, setColumnOptions, removeColumn, saveFieldsManager,
  };
})();
