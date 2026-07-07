/* ── Program data (loaded dynamically from server) ────────────────────────── */
let programsMap = {};   // keyed by program name, populated in loadAll()

function progColor(p)    { return (programsMap[p] || {}).color    || '#8A7A6E'; }
function progDuration(p) { return (programsMap[p] || {}).duration || 1; }
function getWeekDef(program, week) {
  const prog = programsMap[program];
  if (!prog) return null;
  return prog.weeks?.[week] || prog.weeks?.[String(week)] || null;
}
function getPhaseLabel(program, week) {
  const def = getWeekDef(program, week);
  return def?.phase || '';
}

/* ── State ────────────────────────────────────────────────────────────────── */
let clients = [];
let team = [];
let gathrMembers = [];
let localStore = {};
let activeTab = 'overview';
let modalClient = null;
let modalViewWeek = 1;
let modalChecklistData = {};
let charts = {};
let addonsMap = {};
// Program builder state
let pbSelectedProgram = null;
let pbSelectedWeek    = 1;
let pbProgramView     = 'clients'; // 'clients' | 'builder' | 'addons'
let pbSelectedAddon   = null;

/* ── Utils ────────────────────────────────────────────────────────────────── */
function initials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function statusClass(s) {
  const m = {
    'New Client':   'badge-intake',
    'Onboarding':   'badge-onboarding',
    'In Progress':  'badge-active',
    'Launch Ready': 'badge-completed',
    'Completed':    'badge-blue',
    'Alumni':       'badge-paused',
  };
  return m[s] || 'badge-intake';
}

// (progColor / progDuration defined above with programsMap)

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

// (getPhaseLabel defined above with programsMap)

function normalize(s) { return (s || '').toLowerCase().trim(); }

/* ── Deadline logic ───────────────────────────────────────────────────────── */
function deadlineStatus(c) {
  if (!c.startDate || !c.program) return null;
  const start = new Date(c.startDate);
  if (isNaN(start)) return null;
  const dur = progDuration(c.program);
  const today = new Date();
  const elapsedDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const elapsedWeeks = Math.floor(elapsedDays / 7);
  const expectedWeek = Math.min(elapsedWeeks + 1, dur);
  const actualWeek = c.currentWeek || 1;
  const endDate = new Date(start.getTime() + dur * 7 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
  const gap = expectedWeek - actualWeek; // positive = behind schedule

  if (c.status === 'Completed' || c.status === 'Alumni') return { state: 'done', gap: 0, daysLeft };
  if (daysLeft < 0 && c.status !== 'Completed' && c.status !== 'Alumni') return { state: 'overdue', gap, daysLeft };
  if (gap >= 3) return { state: 'delayed', gap, daysLeft };
  if (gap >= 1) return { state: 'at-risk', gap, daysLeft };
  return { state: 'on-track', gap, daysLeft };
}

function deadlineBadge(c) {
  const d = deadlineStatus(c);
  if (!d || d.state === 'done') return '';
  const map = {
    'overdue':  ['🔴', '#b91c1c', '#fef2f2', 'Overdue'],
    'delayed':  ['🟠', '#c2410c', '#fff7ed', `Behind ${d.gap}wk`],
    'at-risk':  ['🟡', '#b45309', '#fffbeb', `Watch`],
    'on-track': ['🟢', '#15803d', '#f0fdf4', 'On Track'],
  };
  const [, color, bg, label] = map[d.state] || map['on-track'];
  return `<span class="dl-badge" style="background:${bg};color:${color}">${label}</span>`;
}

function endDateLabel(c) {
  if (!c.startDate || !c.program) return '—';
  const start = new Date(c.startDate);
  if (isNaN(start)) return '—';
  const dur = progDuration(c.program);
  const end = new Date(start.getTime() + dur * 7 * 24 * 60 * 60 * 1000);
  return end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */
async function checkAuth() {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.authenticated) showApp();
  else showLogin();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadAll();
}

document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pw  = document.getElementById('login-pw').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (res.ok) showApp();
  else err.textContent = 'Incorrect password. Try again.';
}

/* ── Data Loading ─────────────────────────────────────────────────────────── */
async function loadAll() {
  document.getElementById('loading').classList.remove('hidden');
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));

  const [cRes, tRes, lRes, pRes, aRes] = await Promise.all([
    fetch('/api/clients'), fetch('/api/team'), fetch('/api/local'), fetch('/api/programs'), fetch('/api/addons'),
  ]);
  clients    = await cRes.json();
  const teamData = await tRes.json();
  // teamData is now [{id,name,email,role}] — extract names for backward compat
  team       = teamData.map(m => typeof m === 'string' ? m : m.name);
  window._teamFull = teamData; // full objects for Team Management UI
  localStore = await lRes.json();
  programsMap = await pRes.json();
  addonsMap   = await aRes.json();

  populateAssigneeFilters();
  document.getElementById('loading').classList.add('hidden');
  showTab(activeTab);
}

document.getElementById('btn-refresh').addEventListener('click', loadAll);

/* ── Tab routing ──────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showTab(btn.dataset.tab);
  });
});

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.classList.remove('hidden');

  if      (tab === 'overview')   renderOverview();
  else if (tab === 'clients')    renderClients();
  else if (tab === 'programs')   renderPrograms();
  else if (tab === 'analytics')  renderAnalytics();
  else if (tab === 'intake')     renderIntakes();
  else if (tab === 'team')       renderTeam();
}

/* ── Assignee filters ─────────────────────────────────────────────────────── */
function populateAssigneeFilters() {
  const sel = document.getElementById('filter-assignee');
  sel.innerHTML = '<option value="">All Assignees</option>';
  team.forEach(t => {
    const o = document.createElement('option'); o.value = t; o.textContent = t;
    sel.appendChild(o);
  });

  ['cm-lead', 'cm-tech', 'cm-note-author'].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = id === 'cm-note-author' ? '' : '<option value="">— Unassigned —</option>';
    team.forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      s.appendChild(o);
    });
  });

  // Populate program dropdowns from dynamic programsMap
  const progNames = Object.keys(programsMap);
  ['filter-program', 'cm-program'].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    const isFilter = id === 'filter-program';
    s.innerHTML = isFilter ? '<option value="">All Programs</option>' : '<option value="">— Select —</option>';
    progNames.forEach(name => {
      const o = document.createElement('option'); o.value = name; o.textContent = name;
      s.appendChild(o);
    });
  });

  // Populate addon checkboxes dynamically
  const addonBox = document.getElementById('addon-checkboxes');
  if (addonBox) {
    addonBox.innerHTML = Object.values(addonsMap).map(a => `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="addon-cb" data-addon="${escHtml(a.name)}"
          style="accent-color:var(--accent);width:15px;height:15px"> ${escHtml(a.name)}
      </label>`).join('');
  }
}

/* ── Gathr Space member lookup ────────────────────────────────────────────── */
function findGathrMember(client) {
  if (!gathrMembers.length) return null;
  const name  = normalize(client.name);
  const email = normalize(client.email);
  return gathrMembers.find(m => {
    const f = m.fields;
    // Try matching by email first (most reliable), then name
    const mEmail = normalize(f['Email'] || f['email'] || '');
    const mName  = normalize(f['Name'] || f['Full Name'] || f['Client Name'] || '');
    return (email && mEmail && email === mEmail) || (name && mName && name === mName);
  }) || null;
}

function renderSpaceInfo(member) {
  if (!member) {
    document.getElementById('cm-space-info').innerHTML = '';
    document.getElementById('cm-space-badge').style.display = 'none';
    return;
  }
  document.getElementById('cm-space-badge').style.display = 'inline-flex';
  const f = member.fields;
  // Show applicable fields that aren't already in the client record
  const rows = [];
  const interesting = [
    ['Membership', f['Membership'] || f['Membership Type'] || f['Plan']],
    ['Member Since', fmtDate(f['Member Since'] || f['Start Date'] || f['Join Date'])],
    ['Location',  f['Location'] || f['Space'] || f['Suburb']],
    ['Occupation', f['Occupation'] || f['Role'] || f['Job Title']],
  ];
  interesting.forEach(([label, val]) => {
    if (val && String(val).trim() && String(val).trim() !== '—') {
      rows.push(`<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-val">${val}</span></div>`);
    }
  });
  if (!rows.length) {
    document.getElementById('cm-space-info').innerHTML = '';
    return;
  }
  document.getElementById('cm-space-info').innerHTML = `
    <div class="gathr-space-banner" style="margin-top:10px">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      Gathr Space Member
    </div>
    ${rows.join('')}`;
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
function renderOverview() {
  const active    = clients.filter(c => c.status === 'In Progress').length;
  const intake    = clients.filter(c => c.status === 'New Client').length;
  const paused    = clients.filter(c => c.status === 'Alumni').length;
  const completed = clients.filter(c => c.status === 'Completed' || c.status === 'Launch Ready').length;

  document.getElementById('kpi-active').textContent     = active;
  document.getElementById('kpi-intake').textContent     = intake;
  document.getElementById('kpi-paused').textContent     = paused;
  document.getElementById('kpi-completed').textContent  = completed;
  document.getElementById('kpi-active-sub').textContent = `${clients.length} total clients`;
  document.getElementById('overview-subtitle').textContent =
    `${clients.filter(c => ['In Progress','Active','Onboarding'].includes(c.status)).length} active · refreshed ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
  const ovDate = document.getElementById('ov-date-label');
  if (ovDate) ovDate.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  renderTodaysRead();
  renderDeadlineHealth();
  renderWeekTimeline('week-timeline-container', clients.filter(c => c.status === 'In Progress' || c.status === 'Onboarding' || c.status === 'Launch Ready'));
  renderChart('chart-programs', 'doughnut', programChartData());
  renderChart('chart-status',   'doughnut', statusChartData());
}

/* ── Deadline Health Cards ────────────────────────────────────────────────── */
function renderDeadlineHealth() {
  const active = clients.filter(c => ['In Progress','Onboarding','Launch Ready'].includes(c.status));
  const counts = { 'on-track': 0, 'at-risk': 0, 'delayed': 0, 'overdue': 0 };
  active.forEach(c => {
    const d = deadlineStatus(c);
    if (!d) return;
    counts[d.state] = (counts[d.state] || 0) + 1;
  });
  document.getElementById('dlh-on-track').textContent = counts['on-track'];
  document.getElementById('dlh-at-risk').textContent  = counts['at-risk'];
  document.getElementById('dlh-behind').textContent   = counts['delayed'];
  document.getElementById('dlh-overdue').textContent  = counts['overdue'];
}

/* ── Today's Read ─────────────────────────────────────────────────────────── */
function renderTodaysRead() {
  const el = document.getElementById('todays-read');
  if (!el) return;

  const active = clients.filter(c => ['In Progress','Onboarding','Launch Ready'].includes(c.status));
  const overdue  = active.filter(c => deadlineStatus(c)?.state === 'overdue');
  const delayed  = active.filter(c => deadlineStatus(c)?.state === 'delayed');
  const atRisk   = active.filter(c => deadlineStatus(c)?.state === 'at-risk');
  const newIntakes = clients.filter(c => c.status === 'New Client');
  const unassigned = active.filter(c => !c.leadAssignee && !c.techAssignee);

  // Clients finishing within 2 weeks
  const wrappingSoon = active.filter(c => {
    const d = deadlineStatus(c);
    return d && d.daysLeft >= 0 && d.daysLeft <= 14;
  });

  const items = [];

  if (overdue.length) {
    items.push({ level: 'critical', icon: '🔴', title: `${overdue.length} client${overdue.length > 1 ? 's' : ''} overdue`, body: overdue.map(c => `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span>`).join(', ') });
  }
  if (delayed.length) {
    items.push({ level: 'warn', icon: '🟠', title: `${delayed.length} client${delayed.length > 1 ? 's' : ''} behind schedule`, body: delayed.map(c => { const d = deadlineStatus(c); return `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span> (${d.gap}wk behind)`; }).join(', ') });
  }
  if (atRisk.length) {
    items.push({ level: 'caution', icon: '🟡', title: `${atRisk.length} client${atRisk.length > 1 ? 's' : ''} at risk of slipping`, body: atRisk.map(c => `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span>`).join(', ') });
  }
  if (newIntakes.length) {
    items.push({ level: 'info', icon: '📥', title: `${newIntakes.length} new intake${newIntakes.length > 1 ? 's' : ''} awaiting review`, body: newIntakes.map(c => `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span>`).join(', ') });
  }
  if (wrappingSoon.length) {
    items.push({ level: 'info', icon: '🏁', title: `${wrappingSoon.length} client${wrappingSoon.length > 1 ? 's' : ''} wrapping up soon`, body: wrappingSoon.map(c => { const d = deadlineStatus(c); return `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span> (${d.daysLeft}d left)`; }).join(', ') });
  }
  if (unassigned.length) {
    items.push({ level: 'caution', icon: '👤', title: `${unassigned.length} active client${unassigned.length > 1 ? 's' : ''} with no team assigned`, body: unassigned.map(c => `<span class="tr-client-link" onclick="openModal('${c.id}')">${c.name}</span>`).join(', ') });
  }

  if (!items.length) {
    el.innerHTML = `<div class="tr-all-good"><span>✅</span><span>All active clients are on track — nothing urgent today.</span></div>`;
    return;
  }

  const levelColor = { critical: '#b91c1c', warn: '#c2410c', caution: '#b45309', info: '#1d4ed8' };
  const levelBg    = { critical: '#fef2f2', warn: '#fff7ed', caution: '#fffbeb', info: '#eff6ff' };
  const levelBorder= { critical: '#fca5a5', warn: '#fdba74', caution: '#fcd34d', info: '#bfdbfe' };

  el.innerHTML = items.map(item => `
    <div class="tr-item" style="border-left-color:${levelBorder[item.level]};background:${levelBg[item.level]}">
      <div class="tr-item-header">
        <span class="tr-icon">${item.icon}</span>
        <strong style="color:${levelColor[item.level]}">${item.title}</strong>
      </div>
      <div class="tr-item-body">${item.body}</div>
    </div>`).join('');
}

/* ── Week timeline ────────────────────────────────────────────────────────── */
function renderWeekTimeline(containerId, list) {
  const wrap = document.getElementById(containerId);
  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--text3);font-size:13px;text-align:center;padding:20px 0">No active clients yet.</p>';
    return;
  }
  wrap.innerHTML = list.map(c => {
    const dur   = progDuration(c.program) || 1;
    const week  = Math.min(c.currentWeek || 1, dur);
    const pct   = (week / dur) * 100;
    const color = progColor(c.program);
    const phase = getPhaseLabel(c.program, week);
    return `<div class="wt-row">
      <div class="wt-name" title="${c.name}">${c.name}</div>
      <div class="wt-track" onclick="openModal('${c.id}')">
        <div style="width:${pct}%;height:100%;background:${color};opacity:.8;border-radius:5px;display:flex;align-items:center;padding-left:8px">
          ${pct > 15 ? `<span style="font-size:11px;font-weight:600;color:rgba(255,255,255,.9)">${phase || c.program || 'Active'}</span>` : ''}
        </div>
      </div>
      <div class="wt-week-label">Wk ${week}/${dur}</div>
    </div>`;
  }).join('');
}

/* ── Charts ───────────────────────────────────────────────────────────────── */
function renderChart(id, type, data) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#6B5C50', font: { size: 11, family: 'Inter' }, padding: 12 } } },
      scales: type === 'bar' ? {
        x: { ticks: { color: '#9A8C83', font: { size: 11 } }, grid: { color: '#D9D1C5' } },
        y: { ticks: { color: '#9A8C83', font: { size: 11 } }, grid: { color: '#D9D1C5' } },
      } : undefined,
    },
  });
}

function programChartData() {
  const counts = {};
  clients.forEach(c => { const k = c.program || 'Unassigned'; counts[k] = (counts[k] || 0) + 1; });
  const labels = Object.keys(counts);
  return { labels, datasets: [{ data: Object.values(counts), backgroundColor: labels.map(l => progColor(l)), borderWidth: 0 }] };
}

function statusChartData() {
  const counts = {};
  clients.forEach(c => { const k = c.status || 'Unknown'; counts[k] = (counts[k] || 0) + 1; });
  const colors = { 'In Progress': '#4A7C5C', Alumni: '#B07A28', Completed: '#3B6B9A', 'New Client': '#7A52A0', Onboarding: '#C4522A', 'Launch Ready': '#3B6B9A', Unknown: '#8A7A6E' };
  const labels = Object.keys(counts);
  return { labels, datasets: [{ data: Object.values(counts), backgroundColor: labels.map(l => colors[l] || '#8A7A6E'), borderWidth: 0 }] };
}

/* ── Clients table ────────────────────────────────────────────────────────── */
function renderClients() {
  const search    = (document.getElementById('client-search').value || '').toLowerCase();
  const statusF   = document.getElementById('filter-status').value;
  const progF     = document.getElementById('filter-program').value;
  const assigneeF = document.getElementById('filter-assignee').value;

  const list = clients.filter(c => {
    if (statusF   && c.status !== statusF) return false;
    if (progF     && c.program !== progF)  return false;
    if (assigneeF && c.leadAssignee !== assigneeF && c.techAssignee !== assigneeF) return false;
    if (search && !`${c.name} ${c.businessName} ${c.email}`.toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById('clients-subtitle').textContent = `${list.length} client${list.length !== 1 ? 's' : ''}`;
  const tbody = document.getElementById('client-tbody');
  const empty = document.getElementById('client-empty');

  if (!list.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = list.map(c => {
    const dur   = progDuration(c.program);
    const week  = Math.min(c.currentWeek || 1, dur);
    const pct   = Math.round((week / dur) * 100);
    const color = progColor(c.program);
    const cid   = c.id;

    const statusOpts = ['New Client','Onboarding','In Progress','Active','Launch Ready','Completed','Alumni']
      .map(s => `<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('');
    const teamOpts = (sel) => `<option value="">—</option>` +
      team.map(t => `<option value="${t}" ${sel===t?'selected':''}>${t}</option>`).join('');

    return `<tr class="client-row" onclick="openModal('${cid}')">
      <td>
        <div class="name-cell">
          <div class="avatar">${initials(c.name)}</div>
          <div><strong>${c.name}</strong><small>${c.businessName || c.email}</small></div>
        </div>
      </td>
      <td>${c.program ? `<span class="prog-badge" style="background:${color}20;color:${color}">${c.program}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td style="min-width:140px">
        <div class="week-progress">
          <span class="week-label">Wk ${week}/${dur}</span>
          <div class="progress-bar-wrap" style="width:80px">
            <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </td>
      <td onclick="event.stopPropagation()">
        <select class="tbl-select tbl-status" onchange="quickPatch('${cid}','status',this.value,this)">
          ${statusOpts}
        </select>
      </td>
      <td class="text-sm text-muted">${deadlineBadge(c) || '<span class="text-muted text-sm">—</span>'}</td>
      <td onclick="event.stopPropagation()">
        <select class="tbl-select tbl-assignee" onchange="quickPatch('${cid}','leadAssignee',this.value,this)">
          ${teamOpts(c.leadAssignee)}
        </select>
      </td>
      <td onclick="event.stopPropagation()">
        <select class="tbl-select tbl-assignee" onchange="quickPatch('${cid}','techAssignee',this.value,this)">
          ${teamOpts(c.techAssignee)}
        </select>
      </td>
      <td onclick="event.stopPropagation()">
        <input type="date" class="tbl-date" value="${c.startDate||''}"
          onchange="quickPatch('${cid}','startDate',this.value,this)">
      </td>
      <td class="text-sm text-muted">${endDateLabel(c)}</td>
      <td><button class="btn-view" onclick="event.stopPropagation();openModal('${cid}')">Edit →</button></td>
    </tr>`;
  }).join('');
}

['client-search', 'filter-status', 'filter-program', 'filter-assignee'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => { if (activeTab === 'clients') renderClients(); });
});

/* ── By Program / Builder ─────────────────────────────────────────────────── */
function renderPrograms() {
  if (pbProgramView === 'builder') {
    renderProgramBuilder();
  } else {
    renderProgramClientsView();
  }
}

function switchProgramView(view) {
  pbProgramView = view;
  document.getElementById('vt-clients').classList.toggle('active', view === 'clients');
  document.getElementById('vt-builder').classList.toggle('active', view === 'builder');
  document.getElementById('vt-addons').classList.toggle('active', view === 'addons');
  document.getElementById('prog-clients-view').classList.toggle('hidden', view !== 'clients');
  document.getElementById('prog-builder-view').classList.toggle('hidden', view !== 'builder');
  document.getElementById('addon-builder-view').classList.toggle('hidden', view !== 'addons');
  document.getElementById('prog-filter-status').style.display = view === 'clients' ? '' : 'none';
  if (view === 'clients') renderProgramClientsView();
  else if (view === 'builder') renderProgramBuilder();
  else renderAddonBuilder();
}

function renderProgramClientsView() {
  const statusF = document.getElementById('prog-filter-status').value;
  const list    = clients.filter(c => !statusF || c.status === statusF);
  document.getElementById('programs-subtitle').textContent = `${list.length} clients`;
  document.getElementById('programs-tab-title').textContent = 'By Program';

  const grouped = {};
  list.forEach(c => { const key = c.program || 'Unassigned'; if (!grouped[key]) grouped[key] = []; grouped[key].push(c); });

  const order = [...Object.keys(programsMap), 'Unassigned'];
  document.getElementById('prog-view-container').innerHTML = order.filter(k => grouped[k]?.length).map(k => {
    const grp   = grouped[k];
    const color = progColor(k);
    const cards = grp.map(c => {
      const dur   = progDuration(c.program);
      const wk    = Math.min(c.currentWeek || 1, dur);
      const pct   = Math.round((wk / dur) * 100);
      const phase = getPhaseLabel(c.program, wk);
      return `<div class="prog-client-card" onclick="openModal('${c.id}')">
        <div class="prog-card-top">
          <div><div class="prog-card-name">${c.name}</div><div class="prog-card-biz">${c.businessName || c.email}</div></div>
          <span class="badge ${statusClass(c.status)}">${c.status || '—'}</span>
        </div>
        ${phase ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${phase}</div>` : ''}
        <div style="background:var(--surface3);border-radius:4px;height:5px;margin-bottom:8px">
          <div style="width:${pct}%;height:100%;border-radius:4px;background:${color}"></div>
        </div>
        <div class="prog-card-meta">
          <span>Week ${wk} / ${dur}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${deadlineBadge(c)}
            ${c.leadAssignee ? `<span style="font-size:11px;color:var(--text2)">L: ${c.leadAssignee}</span>` : ''}
            ${c.techAssignee ? `<span style="font-size:11px;color:var(--text2)">T: ${c.techAssignee}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div class="prog-section">
      <div class="prog-section-header">
        <div class="prog-section-dot" style="background:${color}"></div>
        <div class="prog-section-title">${k}</div>
        <div class="prog-section-count">${grp.length}</div>
      </div>
      <div class="prog-grid">${cards}</div>
    </div>`;
  }).join('') || '<p style="color:var(--text3);padding:24px;text-align:center">No clients match.</p>';
}

document.getElementById('prog-filter-status').addEventListener('change', () => {
  if (activeTab === 'programs') renderProgramClientsView();
});

/* ── Program Builder ──────────────────────────────────────────────────────── */
function renderProgramBuilder() {
  document.getElementById('programs-tab-title').textContent = 'Manage Programs';
  document.getElementById('programs-subtitle').textContent = `${Object.keys(programsMap).length} programs`;

  // Sidebar list
  const listEl = document.getElementById('pb-prog-list');
  listEl.innerHTML = Object.values(programsMap).map(p => `
    <div class="pb-prog-item ${pbSelectedProgram === p.name ? 'active' : ''}"
         onclick="selectProgram('${p.name.replace(/'/g,"\\'")}')">
      <span class="pb-prog-dot" style="background:${p.color}"></span>
      <span class="pb-prog-label">${p.name}</span>
      <span class="pb-prog-dur">${p.duration}wk</span>
    </div>`).join('');

  if (pbSelectedProgram && programsMap[pbSelectedProgram]) {
    renderProgramEditor(programsMap[pbSelectedProgram]);
  }
}

function selectProgram(name) {
  pbSelectedProgram = name;
  pbSelectedWeek    = 1;
  renderProgramBuilder();
}

function renderProgramEditor(prog) {
  const wk  = pbSelectedWeek;
  const def = prog.weeks?.[wk] || prog.weeks?.[String(wk)] || { title: `Week ${wk}`, phase: '', items: [] };

  document.getElementById('pb-content').innerHTML = `
    <div class="pb-editor">
      <div class="pb-editor-header">
        <div class="pb-color-preview" style="background:${prog.color}"></div>
        <div>
          <div class="pb-editor-name">${prog.name}</div>
          <div class="pb-editor-meta">${prog.duration} weeks · ${prog.price || 'No price set'}</div>
        </div>
        <button class="pb-delete-btn" onclick="deleteProgram('${prog.name.replace(/'/g,"\\'")}')">Delete Program</button>
      </div>

      <div class="pb-section">
        <div class="pb-section-title">Program Details</div>
        <div class="pb-form-grid">
          <div class="pb-field">
            <label>Name</label>
            <input type="text" id="pb-name" value="${escHtml(prog.name)}" class="pb-input">
          </div>
          <div class="pb-field">
            <label>Price</label>
            <input type="text" id="pb-price" value="${escHtml(prog.price || '')}" placeholder="e.g. $1,500" class="pb-input">
          </div>
          <div class="pb-field">
            <label>Duration (weeks)</label>
            <input type="number" id="pb-duration" value="${prog.duration}" min="1" max="52" class="pb-input" style="width:80px">
          </div>
          <div class="pb-field">
            <label>Colour</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="color" id="pb-color" value="${prog.color}" class="pb-color-input">
              <span id="pb-color-val" style="font-size:12px;color:var(--text3)">${prog.color}</span>
            </div>
          </div>
        </div>
        <button class="btn-primary pb-save-btn" onclick="saveProgramDetails()">Save Details</button>
        <span id="pb-details-msg" class="save-msg" style="margin-left:10px"></span>
      </div>

      <div class="pb-section">
        <div class="pb-section-title">Week Deliverables</div>
        <div class="pb-week-nav">
          <button class="week-nav-btn" onclick="pbChangeWeek(-1)" ${wk <= 1 ? 'disabled' : ''}>‹</button>
          <span class="pb-week-label">Week ${wk} of ${prog.duration}</span>
          <button class="week-nav-btn" onclick="pbChangeWeek(1)" ${wk >= prog.duration ? 'disabled' : ''}>›</button>
        </div>
        <div class="pb-week-form">
          <div class="pb-field" style="flex:2">
            <label>Week Title</label>
            <input type="text" id="pb-week-title" value="${escHtml(def.title || '')}" placeholder="e.g. Week 1 — Onboarding" class="pb-input">
          </div>
          <div class="pb-field" style="flex:1">
            <label>Phase</label>
            <input type="text" id="pb-week-phase" value="${escHtml(def.phase || '')}" placeholder="e.g. Onboarding" class="pb-input">
          </div>
        </div>

        <div class="pb-items-list" id="pb-items-list">
          ${(def.items || []).map((item, i) => `
            <div class="pb-item-row" id="pb-item-${i}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text3);flex-shrink:0"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>
              <input type="text" class="pb-item-input" value="${escHtml(item.label)}" onchange="updateItemLabel(${i}, this.value)">
              <button class="pb-item-remove" onclick="removeDeliverable(${i})">×</button>
            </div>`).join('')}
        </div>

        <div class="pb-add-row">
          <input type="text" id="pb-new-item" class="pb-input" placeholder="New deliverable…" onkeydown="if(event.key==='Enter')addDeliverable()">
          <button class="btn-view" onclick="addDeliverable()">+ Add</button>
        </div>
        <div style="margin-top:10px">
          <button class="btn-primary pb-save-btn" onclick="saveWeekDef()">Save Week ${wk}</button>
          <span id="pb-week-msg" class="save-msg" style="margin-left:10px"></span>
        </div>
      </div>
    </div>`;

  // Sync color input display
  document.getElementById('pb-color').addEventListener('input', e => {
    document.getElementById('pb-color-val').textContent = e.target.value;
    document.getElementById('pb-editor-header')?.querySelector('.pb-color-preview')
      && (document.querySelector('.pb-color-preview').style.background = e.target.value);
  });
}

function pbChangeWeek(delta) {
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  pbSelectedWeek = Math.max(1, Math.min(prog.duration, pbSelectedWeek + delta));
  renderProgramEditor(prog);
}

function updateItemLabel(index, label) {
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  const wk   = String(pbSelectedWeek);
  prog.weeks  = prog.weeks || {};
  prog.weeks[wk] = prog.weeks[wk] || { title: '', phase: '', items: [] };
  if (prog.weeks[wk].items[index]) prog.weeks[wk].items[index].label = label;
}

function addDeliverable() {
  const input = document.getElementById('pb-new-item');
  const label = input.value.trim();
  if (!label) return;
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  const wk = String(pbSelectedWeek);
  prog.weeks = prog.weeks || {};
  prog.weeks[wk] = prog.weeks[wk] || { title: `Week ${pbSelectedWeek}`, phase: '', items: [] };
  const id = label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + Date.now().toString(36).slice(-4);
  prog.weeks[wk].items.push({ id, label });
  input.value = '';
  renderProgramEditor(prog);
}

function removeDeliverable(index) {
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  const wk = String(pbSelectedWeek);
  if (prog.weeks?.[wk]?.items) {
    prog.weeks[wk].items.splice(index, 1);
    renderProgramEditor(prog);
  }
}

async function saveProgramDetails() {
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  const name     = document.getElementById('pb-name').value.trim();
  const price    = document.getElementById('pb-price').value.trim();
  const duration = parseInt(document.getElementById('pb-duration').value) || prog.duration;
  const color    = document.getElementById('pb-color').value;
  const msgEl    = document.getElementById('pb-details-msg');
  msgEl.textContent = 'Saving…'; msgEl.style.color = 'var(--accent)';

  try {
    const res = await fetch(`/api/programs/${encodeURIComponent(pbSelectedProgram)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, duration, color, weeks: prog.weeks }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const updated = await res.json();
    if (name !== pbSelectedProgram) {
      delete programsMap[pbSelectedProgram];
      pbSelectedProgram = name;
    }
    programsMap[name] = updated;
    populateAssigneeFilters();
    msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓ Saved';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
    renderProgramBuilder();
  } catch (e) {
    msgEl.style.color = '#e53e3e'; msgEl.textContent = e.message || 'Error';
  }
}

async function saveWeekDef() {
  const prog = programsMap[pbSelectedProgram];
  if (!prog) return;
  const wk    = pbSelectedWeek;
  const title = document.getElementById('pb-week-title').value.trim();
  const phase = document.getElementById('pb-week-phase').value.trim();
  const msgEl = document.getElementById('pb-week-msg');
  msgEl.textContent = 'Saving…'; msgEl.style.color = 'var(--accent)';

  prog.weeks = prog.weeks || {};
  prog.weeks[wk] = { ...(prog.weeks[wk] || {}), title, phase, items: prog.weeks[wk]?.items || [] };

  try {
    const res = await fetch(`/api/programs/${encodeURIComponent(pbSelectedProgram)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prog),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const updated = await res.json();
    programsMap[pbSelectedProgram] = updated;
    msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓ Saved';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } catch (e) {
    msgEl.style.color = '#e53e3e'; msgEl.textContent = e.message || 'Error';
  }
}

async function createNewProgram() {
  const name = prompt('Program name:');
  if (!name?.trim()) return;
  if (programsMap[name.trim()]) { alert('A program with that name already exists.'); return; }
  try {
    const res = await fetch('/api/programs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), price: '', color: '#8A7A6E', duration: 4 }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const prog = await res.json();
    programsMap[prog.name] = prog;
    pbSelectedProgram = prog.name;
    pbSelectedWeek    = 1;
    populateAssigneeFilters();
    renderProgramBuilder();
  } catch (e) {
    alert('Error creating program: ' + e.message);
  }
}

async function deleteProgram(name) {
  const prog = programsMap[name || pbSelectedProgram];
  if (!prog) return;
  if (!confirm(`Delete program "${prog.name}"? This cannot be undone.\n\nNote: programs with active clients cannot be deleted.`)) return;
  try {
    const res = await fetch(`/api/programs/${encodeURIComponent(prog.name)}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    delete programsMap[prog.name];
    pbSelectedProgram = null;
    populateAssigneeFilters();
    renderProgramBuilder();
    document.getElementById('pb-content').innerHTML = '<div class="pb-empty-state"><p>Program deleted.</p></div>';
  } catch (e) {
    alert('Cannot delete: ' + e.message);
  }
}

/* ── Analytics ────────────────────────────────────────────────────────────── */
function renderAnalytics() {
  document.getElementById('analytics-subtitle').textContent = `${clients.length} clients total`;
  renderChart('chart-a-programs', 'doughnut', programChartData());
  renderChart('chart-a-status',   'doughnut', statusChartData());

  const leadCounts = {};
  clients.forEach(c => { const k = c.leadAssignee || 'Unassigned'; leadCounts[k] = (leadCounts[k] || 0) + 1; });
  renderChart('chart-a-lead', 'bar', { labels: Object.keys(leadCounts), datasets: [{ label: 'Clients', data: Object.values(leadCounts), backgroundColor: '#C4522A88', borderColor: '#C4522A', borderWidth: 1 }] });

  const techCounts = {};
  clients.forEach(c => { const k = c.techAssignee || 'Unassigned'; techCounts[k] = (techCounts[k] || 0) + 1; });
  renderChart('chart-a-tech', 'bar', { labels: Object.keys(techCounts), datasets: [{ label: 'Clients', data: Object.values(techCounts), backgroundColor: '#B07A2888', borderColor: '#B07A28', borderWidth: 1 }] });

  renderWeekTimeline('analytics-timeline', clients.filter(c => c.status === 'In Progress' || c.status === 'Onboarding' || c.status === 'Launch Ready'));
}

/* ── New Intakes ──────────────────────────────────────────────────────────── */
function renderIntakes() {
  const intakes = clients.filter(c => c.status === 'New Client');
  document.getElementById('intake-subtitle').textContent = `${intakes.length} awaiting review`;
  const tbody = document.getElementById('intake-tbody');
  const empty = document.getElementById('intake-empty');
  if (!intakes.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = intakes.map(c => `
    <tr>
      <td><div class="name-cell"><div class="avatar" style="background:var(--purple-dim);color:var(--purple)">${initials(c.name)}</div><div><strong>${c.name}</strong><small>${c.email}</small></div></div></td>
      <td class="text-sm">${c.businessName || '—'}</td>
      <td class="text-sm text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.goals || '—'}</td>
      <td class="text-sm text-muted">${fmtDate(c.intakeSubmitted)}</td>
      <td><span class="badge badge-intake">Intake Received</span></td>
      <td><button class="btn-view" onclick="openModal('${c.id}')">Review →</button></td>
    </tr>`).join('');
}

/* ── Modal ────────────────────────────────────────────────────────────────── */
function openModal(id) {
  modalClient = clients.find(c => c.id === id);
  if (!modalClient) return;
  modalViewWeek    = modalClient.currentWeek || 1;
  modalChecklistData = {};
  populateModal();
  document.getElementById('client-modal').classList.remove('hidden');
  loadChecklist(modalViewWeek);
}

function populateModal() {
  const c = modalClient;

  document.getElementById('cm-avatar').textContent       = initials(c.name);
  document.getElementById('cm-name').textContent         = c.name;
  document.getElementById('cm-biz').textContent          = c.businessName || c.email;
  document.getElementById('cm-name-input').value         = c.name || '';
  document.getElementById('cm-bizname-input').value      = c.businessName || '';
  document.getElementById('cm-email').value              = c.email || '';
  document.getElementById('cm-phone').value              = c.phone || '';
  document.getElementById('cm-insta').value              = c.instagram || '';
  document.getElementById('cm-website').value            = c.website || '';

  const prog  = programsMap[c.program];
  const badge = document.getElementById('cm-prog-badge');
  if (prog) {
    badge.textContent  = prog.name;
    badge.style.background = prog.color + '20';
    badge.style.color  = prog.color;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  const sBadge = document.getElementById('cm-status-badge');
  sBadge.textContent = c.status || '—';
  sBadge.className   = `badge ${statusClass(c.status)}`;

  // Gathr Space cross-reference
  renderSpaceInfo(findGathrMember(c));

  // Program fields
  document.getElementById('cm-business').value = c.business    || '';
  document.getElementById('cm-program').value = c.program     || '';
  document.getElementById('cm-status').value  = c.status      || '';
  document.getElementById('cm-week').value    = c.currentWeek || 1;
  document.getElementById('cm-start').value   = c.startDate   || '';
  document.getElementById('cm-lead').value    = c.leadAssignee || '';
  document.getElementById('cm-tech').value    = c.techAssignee || '';

  // Add-ons — tick dynamic checkboxes
  const addOnStr = c.addOns || '';
  document.querySelectorAll('.addon-cb').forEach(cb => {
    cb.checked = addOnStr.includes(cb.dataset.addon);
  });
  const knownAddons = Object.keys(addonsMap);
  const customText = addOnStr.split(',').map(s => s.trim())
    .filter(s => s && !knownAddons.includes(s)).join(', ');
  document.getElementById('addon-custom').value = customText;

  // Render add-on checklists
  renderAddonChecklists(c);

  // Content fields
  document.getElementById('cm-brand').value    = c.brandDirection || '';
  document.getElementById('cm-services').value = c.servicesAndPricing || '';
  document.getElementById('cm-goals').value    = [c.targetAudience ? 'Audience: ' + c.targetAudience : '', c.goals || ''].filter(Boolean).join('\n');
  document.getElementById('cm-filming').value  = c.filmingAvailability || '';

  // Notes log
  renderNotesLog(c.notesLog || []);

  // Activity log (local store only)
  renderActivityFeed((localStore[c.id] || {}).activityLog || []);

  document.getElementById('modal-save-msg').textContent = '';
  document.getElementById('cm-note-msg').textContent    = '';
  document.getElementById('cm-note-text').value         = '';
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('client-modal').classList.add('hidden');
});
document.getElementById('client-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('client-modal'))
    document.getElementById('client-modal').classList.add('hidden');
});

/* ── Notes log ────────────────────────────────────────────────────────────── */
function renderNotesLog(notes) {
  const list = document.getElementById('cm-notes-list');
  if (!notes || !notes.length) {
    list.innerHTML = '<div class="note-empty">No notes yet.</div>';
    return;
  }
  list.innerHTML = [...notes].reverse().map(n => `
    <div class="note-item">
      <div class="note-meta">
        <span class="note-author">${n.author || 'Team'}</span>
        <span class="note-time">${fmtTs(n.ts)}</span>
      </div>
      <div class="note-text">${escHtml(n.text)}</div>
    </div>`).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

document.getElementById('btn-add-note').addEventListener('click', async () => {
  const text   = document.getElementById('cm-note-text').value.trim();
  const author = document.getElementById('cm-note-author').value;
  const msgEl  = document.getElementById('cm-note-msg');
  if (!text) { msgEl.textContent = 'Write a note first.'; return; }

  const btn = document.getElementById('btn-add-note');
  btn.disabled = true;
  msgEl.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/clients/${modalClient.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, text }),
    });
    if (!res.ok) throw new Error(await res.text());
    const updated = await res.json();
    Object.assign(modalClient, updated);
    const idx = clients.findIndex(x => x.id === modalClient.id);
    if (idx !== -1) clients[idx] = updated;
    renderNotesLog(updated.notesLog || []);
    document.getElementById('cm-note-text').value = '';
    msgEl.textContent = '✓ Note added';
    setTimeout(() => { msgEl.textContent = ''; }, 2500);
  } catch (e) {
    msgEl.textContent = 'Error saving note';
    console.error(e);
  } finally {
    btn.disabled = false;
  }
});

/* ── Activity Log ─────────────────────────────────────────────────────────── */
const ACTIVITY_ICONS = { note: '📝', handoff: '🤝', call: '📞', milestone: '🏁', issue: '⚠️', auto: '🔄', archive: '📦', status: '🔁', coach: '👤' };

function renderActivityFeed(log) {
  const el = document.getElementById('cm-activity-feed');
  if (!log || !log.length) { el.innerHTML = '<div class="note-empty">No activity yet.</div>'; return; }
  el.innerHTML = [...log].reverse().map(e => `
    <div class="activity-item">
      <div class="activity-icon">${ACTIVITY_ICONS[e.type] || '📝'}</div>
      <div class="activity-body">
        <div class="activity-meta">
          <strong>${e.author || 'Team'}</strong>
          <span class="note-time">${fmtTs(e.ts)}</span>
        </div>
        ${e.text ? `<div class="activity-text">${escHtml(e.text)}</div>` : ''}
        ${e.changes ? e.changes.map(ch => `<div class="activity-change"><span>${ch.field}</span><span class="ch-from">${ch.from}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span class="ch-to">${ch.to}</span></div>`).join('') : ''}
      </div>
    </div>`).join('');
}

async function appendActivityEntry(clientId, entry) {
  const existing = (localStore[clientId] || {}).activityLog || [];
  const updated = [...existing, entry];
  const res = await fetch(`/api/local/${clientId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityLog: updated }),
  });
  if (!res.ok) throw new Error(await res.text());
  const stored = await res.json();
  localStore[clientId] = stored;
  return stored.activityLog || [];
}

document.getElementById('btn-log-activity').addEventListener('click', async () => {
  const text   = document.getElementById('cm-activity-text').value.trim();
  const type   = document.getElementById('cm-activity-type').value;
  const author = document.getElementById('cm-note-author').value || 'Team';
  const msgEl  = document.getElementById('cm-activity-msg');
  if (!text) { msgEl.textContent = 'Write something first.'; return; }

  const btn = document.getElementById('btn-log-activity');
  btn.disabled = true; msgEl.textContent = 'Saving…';

  try {
    const log = await appendActivityEntry(modalClient.id, { type, text, author, ts: new Date().toISOString() });
    renderActivityFeed(log);
    document.getElementById('cm-activity-text').value = '';
    msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓ Logged';
    setTimeout(() => { msgEl.textContent = ''; }, 2000);
  } catch (e) {
    msgEl.style.color = '#e53e3e'; msgEl.textContent = 'Error';
    console.error(e);
  } finally { btn.disabled = false; }
});

/* ── Change detection ─────────────────────────────────────────────────────── */
function detectChanges(oldClient, patch) {
  const tracked = {
    business: 'Business', status: 'Status', program: 'Program',
    leadAssignee: 'Lead Coach', techAssignee: 'Tech',
    currentWeek: 'Current Week', startDate: 'Start Date',
  };
  return Object.entries(tracked)
    .filter(([k]) => patch[k] !== undefined && String(oldClient[k] || '') !== String(patch[k] || ''))
    .map(([k, label]) => ({ field: label, from: oldClient[k] || '—', to: patch[k] || '—' }));
}

/* ── Archive client ───────────────────────────────────────────────────────── */
document.getElementById('btn-archive-client').addEventListener('click', async () => {
  if (!modalClient) return;
  if (!confirm(`Archive ${modalClient.name}? This sets them to Alumni and removes them from active views.`)) return;

  const msgEl = document.getElementById('modal-save-msg');
  msgEl.textContent = 'Archiving…'; msgEl.style.color = 'var(--accent)';

  const patch = { status: 'Alumni' };
  const updated = await patchClient(modalClient.id, patch);
  if (updated) {
    await appendActivityEntry(modalClient.id, { type: 'archive', text: `Client archived — moved to Alumni.`, author: 'Team', ts: new Date().toISOString() });
    Object.assign(modalClient, updated);
    const idx = clients.findIndex(x => x.id === modalClient.id);
    if (idx !== -1) clients[idx] = updated;
    document.getElementById('cm-status').value = 'Alumni';
    const sBadge = document.getElementById('cm-status-badge');
    sBadge.textContent = 'Alumni'; sBadge.className = 'badge badge-paused';
    msgEl.style.color = 'var(--green)'; msgEl.textContent = '✓ Archived';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  }
});

/* ── Delete client ────────────────────────────────────────────────────────── */
document.getElementById('btn-delete-client').addEventListener('click', async () => {
  if (!modalClient) return;
  if (!confirm(`Permanently delete ${modalClient.name}? This cannot be undone.`)) return;
  if (!confirm(`Are you sure? Deleting ${modalClient.name} is irreversible.`)) return;

  const msgEl = document.getElementById('modal-save-msg');
  msgEl.textContent = 'Deleting…'; msgEl.style.color = '#e53e3e';

  try {
    const res = await fetch(`/api/clients/${modalClient.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    clients = clients.filter(c => c.id !== modalClient.id);
    document.getElementById('client-modal').classList.add('hidden');
    showTab(activeTab);
    if (activeTab === 'overview') renderOverview();
  } catch (e) {
    msgEl.style.color = '#e53e3e'; msgEl.textContent = 'Delete failed — check console';
    console.error(e);
  }
});

/* ── Checklist (dynamic from programsMap) ─────────────────────────────────── */
async function loadChecklist(week) {
  const c = modalClient;
  if (!c) return;

  const wk = week || 1;
  modalViewWeek = wk;

  if (c.program === 'Old Program') { renderOldProgramChecklist(wk); return; }

  setChecklistLoading(true);
  try {
    const res  = await fetch(`/api/clients/${c.id}/checklist/${wk}`);
    const data = await res.json();
    modalChecklistData[wk] = data;
  } catch {
    modalChecklistData[wk] = { fields: {}, recordId: null };
  }
  setChecklistLoading(false);
  renderChecklist(wk);
}

function setChecklistLoading(on) {
  document.getElementById('cl-gathr').innerHTML  = on ? '<p style="color:var(--text3);font-size:12px;padding:8px 0">Loading…</p>' : '';
  document.getElementById('cl-client').innerHTML = '';
}

function renderOldProgramChecklist(wk) {
  const prog = programsMap['Old Program'];
  const def  = prog?.weeks?.[wk] || prog?.weeks?.[String(wk)];
  const maxWeek = prog?.duration || 4;

  document.getElementById('cl-week-display').textContent = `Week ${wk}`;
  document.getElementById('cl-prev').disabled = wk <= 1;
  document.getElementById('cl-next').disabled = wk >= maxWeek;
  document.getElementById('checklist-section-client').style.display = 'none';

  if (!def) {
    document.getElementById('cl-week-title').textContent = `Week ${wk}`;
    document.getElementById('cl-phase-label').textContent = '';
    document.getElementById('checklist-section-gathr').style.display = 'none';
    document.getElementById('cl-gathr').innerHTML = '<p style="color:var(--text3);font-size:12px;padding:8px 0">No deliverables defined for this week.</p>';
    return;
  }

  document.getElementById('cl-week-title').textContent = def.title || `Week ${wk}`;
  document.getElementById('cl-phase-label').textContent = def.phase || '';
  document.getElementById('checklist-section-gathr').style.display = def.items?.length ? '' : 'none';

  const state = (localStore[modalClient.id] || {}).oldProgramChecklist || {};
  document.getElementById('cl-gathr').innerHTML = (def.items || []).map(({ id, label }) => {
    const done = !!state[id];
    return `<div class="checklist-item" onclick="toggleOldProgramCheck('${id}',${!done})">
      <div class="check-box ${done ? 'checked' : ''}">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
      </div>
      <span class="check-label ${done ? 'done' : ''}">${label}</span>
    </div>`;
  }).join('') || '<p style="color:var(--text3);font-size:12px;padding:8px 0">No deliverables for this week yet.</p>';
}

async function toggleOldProgramCheck(field, newValue) {
  const id = modalClient?.id;
  if (!id) return;
  localStore[id] = localStore[id] || {};
  localStore[id].oldProgramChecklist = localStore[id].oldProgramChecklist || {};
  localStore[id].oldProgramChecklist[field] = newValue;
  renderOldProgramChecklist(modalViewWeek);
  try {
    const res = await fetch(`/api/local/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldProgramChecklist: localStore[id].oldProgramChecklist }),
    });
    const stored = await res.json();
    localStore[id] = stored;
  } catch (e) {
    localStore[id].oldProgramChecklist[field] = !newValue;
    renderOldProgramChecklist(modalViewWeek);
    console.error('toggleOldProgramCheck failed', e);
  }
}

function renderChecklist(wk) {
  const prog = programsMap[modalClient?.program];
  const def  = prog?.weeks?.[wk] || prog?.weeks?.[String(wk)];
  const maxWeek = prog?.duration || 1;

  document.getElementById('cl-week-title').textContent   = def?.title || `Week ${wk}`;
  document.getElementById('cl-week-display').textContent = `Week ${wk}`;
  document.getElementById('cl-prev').disabled = wk <= 1;
  document.getElementById('cl-next').disabled = wk >= maxWeek;
  document.getElementById('cl-phase-label').textContent  = def?.phase || '';
  document.getElementById('checklist-section-client').style.display = 'none';

  if (!def || !def.items?.length) {
    document.getElementById('checklist-section-gathr').style.display = 'none';
    document.getElementById('cl-gathr').innerHTML = '<p style="color:var(--text3);font-size:12px;padding:8px 0">No deliverables defined for this week yet. Add them in Manage Programs.</p>';
    return;
  }

  document.getElementById('checklist-section-gathr').style.display = '';
  const fields = (modalChecklistData[wk] || {}).fields || {};

  document.getElementById('cl-gathr').innerHTML = def.items.map(({ id, label }) => {
    const done = !!fields[id];
    return `<div class="checklist-item" onclick="toggleCheck(${wk},'${id.replace(/'/g,"\\'")}',${!done})">
      <div class="check-box ${done ? 'checked' : ''}">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
      </div>
      <span class="check-label ${done ? 'done' : ''}">${label}</span>
    </div>`;
  }).join('');
}

async function toggleCheck(week, field, newValue) {
  const data = modalChecklistData[week] || {};
  data.fields = data.fields || {};
  data.recordId = data.recordId || modalClient?.id;
  modalChecklistData[week] = data;

  data.fields[field] = newValue;
  renderChecklist(week);

  try {
    const res = await fetch(`/api/checklist/${week}/${modalClient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value: newValue }),
    });
    const updated = await res.json();
    if (updated.fields) { modalChecklistData[week].fields = updated.fields; renderChecklist(week); }
  } catch (e) {
    data.fields[field] = !newValue;
    renderChecklist(week);
    console.error('toggleCheck failed', e);
  }
}

document.getElementById('cl-prev').addEventListener('click', () => { modalViewWeek--; loadChecklist(modalViewWeek); });
document.getElementById('cl-next').addEventListener('click', () => { modalViewWeek++; loadChecklist(modalViewWeek); });

/* ── Save client ──────────────────────────────────────────────────────────── */
document.getElementById('btn-save-client').addEventListener('click', async () => {
  const c = modalClient;

  // Build add-ons string from dynamic checkboxes
  const addonParts = [];
  document.querySelectorAll('.addon-cb:checked').forEach(cb => addonParts.push(cb.dataset.addon));
  const customAddon = document.getElementById('addon-custom').value.trim();
  if (customAddon) addonParts.push(customAddon);

  const newName = document.getElementById('cm-name-input').value.trim() || c.name;
  const patch = {
    name:               newName,
    businessName:       document.getElementById('cm-bizname-input').value.trim(),
    email:              document.getElementById('cm-email').value.trim(),
    phone:              document.getElementById('cm-phone').value.trim(),
    instagram:          document.getElementById('cm-insta').value.trim(),
    website:            document.getElementById('cm-website').value.trim(),
    business:           document.getElementById('cm-business').value,
    program:            document.getElementById('cm-program').value,
    status:             document.getElementById('cm-status').value,
    currentWeek:        parseInt(document.getElementById('cm-week').value) || 1,
    startDate:          document.getElementById('cm-start').value,
    leadAssignee:       document.getElementById('cm-lead').value,
    techAssignee:       document.getElementById('cm-tech').value,
    brandDirection:     document.getElementById('cm-brand').value,
    servicesAndPricing: document.getElementById('cm-services').value,
    goals:              document.getElementById('cm-goals').value,
    filmingAvailability:document.getElementById('cm-filming').value,
    addOns:             addonParts.join(', '),
  };

  const msgEl = document.getElementById('modal-save-msg');
  msgEl.textContent = 'Saving…';
  msgEl.style.color = 'var(--accent)';

  const changes = detectChanges(c, patch);
  const updated = await patchClient(c.id, patch);
  if (updated) {
    // Auto-log any detected changes to local activity log
    if (changes.length) {
      const existingLocal = localStore[c.id] || {};
      const author = document.getElementById('cm-lead').value || 'Team';
      const logEntry = { type: 'auto', text: '', author, ts: new Date().toISOString(), changes };
      const mergedLocal = { ...existingLocal, activityLog: [...(existingLocal.activityLog || []), logEntry] };
      fetch(`/api/local/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedLocal),
      }).then(r => r.json()).then(stored => {
        localStore[c.id] = stored;
        renderActivityFeed(stored.activityLog || []);
      }).catch(console.error);
    }

    Object.assign(c, updated);
    const idx = clients.findIndex(x => x.id === c.id);
    if (idx !== -1) clients[idx] = updated;

    document.getElementById('cm-name').textContent = updated.name || '';

    const sBadge = document.getElementById('cm-status-badge');
    sBadge.textContent = updated.status || '—';
    sBadge.className = `badge ${statusClass(updated.status)}`;

    const prog  = programsMap[updated.program];
    const badge = document.getElementById('cm-prog-badge');
    if (prog) { badge.textContent = prog.name; badge.style.background = prog.color + '20'; badge.style.color = prog.color; badge.style.display = 'inline-block'; }

    msgEl.style.color = 'var(--green)';
    msgEl.textContent = '✓ Saved';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } else {
    msgEl.style.color = '#e53e3e';
    msgEl.textContent = 'Error saving — check console';
  }
});

document.getElementById('cm-program').addEventListener('change', () => {
  if (!modalClient) return;
  modalClient.program = document.getElementById('cm-program').value;
  modalViewWeek = 1;
  modalChecklistData = {};
  const prog  = programsMap[modalClient.program];
  const badge = document.getElementById('cm-prog-badge');
  if (prog) { badge.textContent = prog.name; badge.style.background = prog.color + '20'; badge.style.color = prog.color; badge.style.display = 'inline-block'; }
  else badge.style.display = 'none';
  loadChecklist(modalViewWeek);
});

/* ── API ──────────────────────────────────────────────────────────────────── */
async function patchClient(id, patch) {
  try {
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { console.error('Patch failed', await res.text()); return null; }
    return await res.json();
  } catch (e) {
    console.error('patchClient', e);
    return null;
  }
}

/* ── Quick inline patch from table ───────────────────────────────────────── */
async function quickPatch(id, field, value, el) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  const patch = { ...client, [field]: value };
  el.disabled = true;
  const updated = await patchClient(id, patch);
  el.disabled = false;
  if (updated) {
    Object.assign(client, updated);
    const idx = clients.findIndex(c => c.id === id);
    if (idx !== -1) clients[idx] = updated;
    // Re-render to reflect badge/progress changes without resetting the dropdown
    renderClients();
  }
}

/* ── Backup & Restore ─────────────────────────────────────────────────────── */
async function downloadBackup() {
  const res      = await fetch('/api/backup');
  const blob     = await res.blob();
  const date     = new Date().toISOString().split('T')[0];
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `gathr-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm(`Restore from "${file.name}"? This will overwrite ALL current data.`)) { input.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const res  = await fetch('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.ok) {
      alert(`✓ Restored ${result.clientCount} clients. Reloading…`);
      await loadAll();
    } else {
      alert('Restore failed: ' + result.error);
    }
  } catch (e) {
    alert('Restore failed: ' + e.message);
  } finally {
    input.value = '';
  }
}

/* ── Import from Airtable (one-time migration) ────────────────────────────── */
async function importFromAirtable() {
  const result = document.getElementById('import-result');
  if (!confirm('Import all clients from Airtable into the app? Existing local data is preserved — only missing fields will be filled.')) return;

  result.style.display = 'block';
  result.style.background  = 'var(--surface2)';
  result.style.borderColor = 'var(--border)';
  result.style.color       = 'var(--text2)';
  result.textContent       = 'Importing from Airtable…';

  try {
    const res  = await fetch('/api/import-from-airtable', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      result.style.background  = 'var(--green-dim)';
      result.style.borderColor = 'var(--green)';
      result.style.color       = 'var(--green)';
      result.textContent       = `✓ Imported ${data.imported} clients from Airtable into local storage.`;
      await loadAll();
    } else {
      result.style.background  = 'var(--accent-dim)';
      result.style.borderColor = 'var(--accent)';
      result.style.color       = 'var(--accent)';
      result.textContent       = 'Error: ' + (data.error || 'Unknown');
    }
  } catch (e) {
    result.style.color = 'var(--accent)';
    result.textContent = 'Error: ' + e.message;
  }
}

/* ── Migrate Old Program ──────────────────────────────────────────────────── */
function showMigrateOldProgram() {
  document.getElementById('migrate-result').style.display = 'none';
  document.getElementById('migrate-base-id').value = '';
  document.getElementById('migrate-modal').classList.remove('hidden');
}

async function runMigrateOldProgram() {
  const oldBaseId = document.getElementById('migrate-base-id').value.trim();
  const resultEl  = document.getElementById('migrate-result');
  const btn       = document.getElementById('btn-run-migrate');
  if (!oldBaseId) { resultEl.style.display = 'block'; resultEl.style.background = 'var(--accent-dim)'; resultEl.style.color = 'var(--accent)'; resultEl.textContent = 'Paste the base ID first.'; return; }

  btn.disabled = true; btn.textContent = 'Running…';
  resultEl.style.display = 'none';

  try {
    const res  = await fetch('/api/migrate-old-program', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldBaseId }),
    });
    const data = await res.json();
    resultEl.style.display = 'block';
    if (data.ok) {
      resultEl.style.background = 'var(--green-dim)';
      resultEl.style.color = 'var(--green)';
      resultEl.innerHTML = `✓ Updated ${data.updated.length} clients to Old Program.<br>
        ${data.notFound.length ? `<span style="color:var(--amber)">Not matched: ${data.notFound.join(', ')}</span><br>` : ''}
        ${data.errors.length ? `<span style="color:var(--accent)">Errors: ${data.errors.join('; ')}</span>` : ''}`;
      await loadAll();
    } else {
      resultEl.style.background = 'var(--accent-dim)';
      resultEl.style.color = 'var(--accent)';
      resultEl.textContent = 'Error: ' + (data.error || 'Unknown');
    }
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.style.background = 'var(--accent-dim)';
    resultEl.style.color = 'var(--accent)';
    resultEl.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Run Migration';
  }
}

/* ── Team Management ─────────────────────────────────────────────────────── */
function renderTeam() {
  const members = window._teamFull || [];
  document.getElementById('team-subtitle').textContent = `${members.length} member${members.length !== 1 ? 's' : ''}`;
  const tbody = document.getElementById('team-tbody');
  const empty = document.getElementById('team-empty');

  if (!members.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const roleLabel = { admin: 'Admin', lead: 'Lead Coach', tech: 'Tech' };
  const roleBadge = { admin: 'badge-alumni', lead: 'badge-active', tech: 'badge-completed' };

  tbody.innerHTML = members.map(m => `
    <tr class="client-row" onclick="editTeamMember('${m.id}')">
      <td><div class="name-cell">
        <div class="avatar" style="background:var(--accent-dim);color:var(--accent)">${initials(m.name)}</div>
        <div><strong>${escHtml(m.name)}</strong></div>
      </div></td>
      <td class="text-sm text-muted">${escHtml(m.email || '—')}</td>
      <td><span class="badge ${roleBadge[m.role] || ''}">${roleLabel[m.role] || m.role}</span></td>
      <td class="text-sm text-muted">${fmtDate(m.createdAt)}</td>
      <td><button class="btn-view" onclick="event.stopPropagation();deleteTeamMember('${m.id}','${escHtml(m.name)}')">Remove</button></td>
    </tr>`).join('');
}

function showAddTeamMember() {
  document.getElementById('team-modal-title').textContent = 'Add Team Member';
  document.getElementById('tm-id').value   = '';
  document.getElementById('tm-name').value  = '';
  document.getElementById('tm-email').value = '';
  document.getElementById('tm-role').value  = 'lead';
  document.getElementById('tm-msg').textContent = '';
  document.getElementById('team-modal').classList.remove('hidden');
}

function editTeamMember(id) {
  const m = (window._teamFull || []).find(x => x.id === id);
  if (!m) return;
  document.getElementById('team-modal-title').textContent = 'Edit Team Member';
  document.getElementById('tm-id').value   = m.id;
  document.getElementById('tm-name').value  = m.name;
  document.getElementById('tm-email').value = m.email || '';
  document.getElementById('tm-role').value  = m.role || 'lead';
  document.getElementById('tm-msg').textContent = '';
  document.getElementById('team-modal').classList.remove('hidden');
}

async function saveTeamMember() {
  const id    = document.getElementById('tm-id').value;
  const name  = document.getElementById('tm-name').value.trim();
  const email = document.getElementById('tm-email').value.trim();
  const role  = document.getElementById('tm-role').value;
  const msgEl = document.getElementById('tm-msg');

  if (!name) { msgEl.style.color = '#e53e3e'; msgEl.textContent = 'Name is required.'; return; }
  msgEl.textContent = 'Saving…'; msgEl.style.color = 'var(--text3)';

  const method = id ? 'PUT' : 'POST';
  const url    = id ? `/api/team/${id}` : '/api/team';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, role }),
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('team-modal').classList.add('hidden');
    // Reload team data
    const tRes = await fetch('/api/team');
    const teamData = await tRes.json();
    team = teamData.map(m => typeof m === 'string' ? m : m.name);
    window._teamFull = teamData;
    populateAssigneeFilters();
    renderTeam();
  } else {
    msgEl.style.color = '#e53e3e';
    msgEl.textContent = data.error || 'Error saving.';
  }
}

async function deleteTeamMember(id, name) {
  if (!confirm(`Remove ${name} from the team?`)) return;
  const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
  if (res.ok) {
    const tRes = await fetch('/api/team');
    const teamData = await tRes.json();
    team = teamData.map(m => typeof m === 'string' ? m : m.name);
    window._teamFull = teamData;
    populateAssigneeFilters();
    renderTeam();
  }
}

/* ── Add-on Checklist (client modal) ─────────────────────────────────────── */
function renderAddonChecklists(c) {
  const section = document.getElementById('addon-checklist-section');
  if (!section) return;
  const activeAddons = (c.addOns || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!activeAddons.length) { section.innerHTML = ''; return; }

  section.innerHTML = activeAddons.map(addonName => {
    const addon = Object.values(addonsMap).find(a => a.name === addonName);
    if (!addon || !addon.deliverables?.length) return '';
    const checks = (c.addonChecklists?.[addonName]) || {};
    const done  = addon.deliverables.filter(d => checks[d.id]).length;
    const total = addon.deliverables.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;
    const items = addon.deliverables.map(d => `
      <label class="checklist-item ${checks[d.id] ? 'checked' : ''}" style="cursor:pointer">
        <input type="checkbox" ${checks[d.id] ? 'checked' : ''}
          onchange="toggleAddonCheck('${escHtml(addonName)}','${d.id}',this.checked)"
          style="accent-color:var(--accent);width:14px;height:14px;flex-shrink:0">
        <span style="${checks[d.id] ? 'text-decoration:line-through;color:var(--text3)' : ''}">${escHtml(d.label)}</span>
      </label>`).join('');
    return `<div class="addon-checklist-card">
      <div class="addon-checklist-header">
        <span class="addon-checklist-title">${escHtml(addonName)}</span>
        <span class="addon-checklist-prog">${done}/${total} · ${pct}%</span>
      </div>
      <div class="checklist-progress" style="margin-bottom:10px">
        <div style="height:4px;background:var(--surface3);border-radius:4px">
          <div style="width:${pct}%;height:100%;border-radius:4px;background:var(--accent)"></div>
        </div>
      </div>
      <div class="checklist-items">${items}</div>
    </div>`;
  }).join('');
}

async function toggleAddonCheck(addonName, itemId, value) {
  if (!modalClient) return;
  const res = await fetch(`/api/addon-checklist/${modalClient.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addonName, itemId, value }),
  });
  if (res.ok) {
    const data = await res.json();
    modalClient.addonChecklists = data.addonChecklists;
    renderAddonChecklists(modalClient);
  }
}

/* ── Add-on Builder ───────────────────────────────────────────────────────── */
function renderAddonBuilder() {
  document.getElementById('programs-tab-title').textContent = 'Manage Add-ons';
  document.getElementById('programs-subtitle').textContent = `${Object.keys(addonsMap).length} add-ons`;

  const listEl = document.getElementById('pb-addon-list');
  listEl.innerHTML = Object.values(addonsMap).map(a => `
    <div class="pb-prog-item ${pbSelectedAddon === a.name ? 'active' : ''}"
         onclick="selectAddon('${a.name.replace(/'/g,"\\'")}')">
      <span class="pb-prog-label">${escHtml(a.name)}</span>
      <span class="pb-prog-dur">${(a.deliverables||[]).length}d</span>
    </div>`).join('');

  if (pbSelectedAddon && addonsMap[pbSelectedAddon]) {
    renderAddonEditor(addonsMap[pbSelectedAddon]);
  }
}

function selectAddon(name) {
  pbSelectedAddon = name;
  renderAddonBuilder();
}

function renderAddonEditor(addon) {
  const deliverables = addon.deliverables || [];
  document.getElementById('pb-addon-content').innerHTML = `
    <div class="pb-editor-header">
      <div class="pb-editor-title">${escHtml(addon.name)}</div>
      <button class="pb-delete-btn" onclick="deleteAddon('${escHtml(addon.id)}')">Delete Add-on</button>
    </div>
    <div class="pb-form-section">
      <label class="pb-label">Add-on Name</label>
      <input id="pa-name" class="pb-input" value="${escHtml(addon.name)}">
    </div>
    <div class="pb-form-section" style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <label class="pb-label" style="margin:0">Deliverables</label>
        <button class="pb-add-item-btn" onclick="addAddonDeliverable()">+ Add</button>
      </div>
      <div id="pa-deliverables">
        ${deliverables.map((d,i) => `
          <div class="pb-item-row" id="pa-row-${i}">
            <input class="pb-item-input" value="${escHtml(d.label)}"
              oninput="updateAddonItemLabel(${i}, this.value)">
            <button class="pb-item-del" onclick="removeAddonDeliverable(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px">
      <button class="btn-primary pb-save-btn" onclick="saveAddonDetails()">Save Add-on</button>
    </div>
    <div id="pa-save-msg" style="margin-top:8px;font-size:13px"></div>`;
}

let paEdits = {};

function updateAddonItemLabel(idx, val) {
  paEdits[idx] = val;
}

function addAddonDeliverable() {
  if (!pbSelectedAddon || !addonsMap[pbSelectedAddon]) return;
  const addon = addonsMap[pbSelectedAddon];
  addon.deliverables = addon.deliverables || [];
  addon.deliverables.push({ id: 'item_' + Date.now(), label: 'New deliverable' });
  renderAddonEditor(addon);
}

function removeAddonDeliverable(idx) {
  if (!pbSelectedAddon || !addonsMap[pbSelectedAddon]) return;
  const addon = addonsMap[pbSelectedAddon];
  addon.deliverables.splice(idx, 1);
  renderAddonEditor(addon);
}

async function saveAddonDetails() {
  if (!pbSelectedAddon || !addonsMap[pbSelectedAddon]) return;
  const addon    = addonsMap[pbSelectedAddon];
  const msgEl    = document.getElementById('pa-save-msg');
  const newName  = document.getElementById('pa-name').value.trim() || addon.name;

  // Apply any inline edits
  document.querySelectorAll('#pa-deliverables .pb-item-row').forEach((row, i) => {
    const val = row.querySelector('.pb-item-input')?.value.trim();
    if (val && addon.deliverables[i]) addon.deliverables[i].label = val;
  });

  const payload = { name: newName, deliverables: addon.deliverables };
  msgEl.textContent = 'Saving…'; msgEl.style.color = 'var(--accent)';

  const res = await fetch(`/api/addons/${addon.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    const updated = await res.json();
    delete addonsMap[pbSelectedAddon];
    addonsMap[updated.name] = updated;
    pbSelectedAddon = updated.name;
    await loadAll();
    renderAddonBuilder();
    msgEl.style.color = 'var(--green)';
    msgEl.textContent = '✓ Saved';
    setTimeout(() => { msgEl.textContent = ''; }, 2500);
  } else {
    msgEl.style.color = '#e53e3e'; msgEl.textContent = 'Error saving.';
  }
}

async function createNewAddon() {
  const name = prompt('New add-on name:');
  if (!name?.trim()) return;
  const res = await fetch('/api/addons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), deliverables: [] }),
  });
  if (res.ok) {
    const addon = await res.json();
    await loadAll();
    pbSelectedAddon = addon.name;
    renderAddonBuilder();
  }
}

async function deleteAddon(id) {
  const addon = Object.values(addonsMap).find(a => a.id === id);
  if (!addon) return;
  if (!confirm(`Delete add-on "${addon.name}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/addons/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadAll();
    pbSelectedAddon = null;
    renderAddonBuilder();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Error deleting add-on.');
  }
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
checkAuth();
