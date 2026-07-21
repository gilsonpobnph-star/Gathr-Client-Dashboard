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
let myTasks = [];
let clientLastViewed = {}; // clientId → ISO ts, persisted in localStorage
let editingTaskId = null;
let showArchivedTasks = false;
let gathrMembers = [];
let localStore = {};
let activeTab = 'mydash';
let modalClient = null;
let modalViewWeek = 1;
let modalChecklistData = {};
let modalActiveProgram = '';
let modalProgramWeeks  = {};
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
    'New':            'badge-intake',
    'Onboarding':     'badge-onboarding',
    'Active':         'badge-active',
    'On New Program': 'badge-completed',
    'Completed':      'badge-blue',
    'Alumni':         'badge-paused',
    'Closed':         'badge-alumni',
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
  // Use per-program start dates; pick the worst status across all enrolled programs
  const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
  const startDates = c.programStartDates || {};
  // Fallback to legacy single startDate
  const legacyStart = c.startDate;

  let worst = null;
  const stateRank = { overdue: 0, delayed: 1, 'at-risk': 2, 'on-track': 3, done: 4 };

  for (const prog of progs) {
    const sd = startDates[prog] || (progs[0] === prog ? legacyStart : null);
    if (!sd) continue;
    const dur = progDuration(prog);
    if (!dur) continue;
    const start   = new Date(sd);
    const today   = new Date();
    const endDate = new Date(start.getTime() + dur * 7 * 24 * 60 * 60 * 1000);
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    const gap     = Math.abs(Math.round((today - endDate) / (1000 * 60 * 60 * 24 * 7)));
    const ps      = (c.programStatuses || {})[prog];

    let state;
    if (['Completed','Cancelled'].includes(ps)) { state = 'done'; }
    else if (['Completed','Alumni','Closed'].includes(c.status)) { state = 'done'; }
    else if (daysLeft < 0) { state = 'overdue'; }
    else if (daysLeft < 14) { state = 'at-risk'; }
    else if (daysLeft < 21) { state = 'delayed'; }
    else { state = 'on-track'; }

    const d = { state, gap, daysLeft, prog };
    if (!worst || (stateRank[state] ?? 99) < (stateRank[worst.state] ?? 99)) worst = d;
  }
  return worst;
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
  const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
  const startDates = c.programStartDates || {};
  for (const prog of progs) {
    const sd = startDates[prog] || (progs[0] === prog ? c.startDate : null);
    if (!sd) continue;
    const dur = progDuration(prog);
    if (!dur) continue;
    const end = new Date(new Date(sd).getTime() + dur * 7 * 24 * 60 * 60 * 1000);
    return end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return '—';
}

/* ── Client activity tracking ────────────────────────────────────────────── */
function loadClientLastViewed() {
  try { clientLastViewed = JSON.parse(localStorage.getItem('clientLastViewed') || '{}'); } catch { clientLastViewed = {}; }
}
function markClientViewed(clientId) {
  clientLastViewed[clientId] = new Date().toISOString();
  try { localStorage.setItem('clientLastViewed', JSON.stringify(clientLastViewed)); } catch {}
}
function hasNewActivity(c) {
  if (!c.lastActivityAt) return false;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (c.lastActivityAt < sevenDaysAgo) return false; // older than 7 days, skip
  const lastViewed = clientLastViewed[c.id];
  if (!lastViewed) return true; // never viewed → show dot
  return c.lastActivityAt > lastViewed;
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */
let currentUser = { authenticated: false, role: 'member', name: '', userId: '' };

async function checkAuth() {
  const res  = await fetch('/api/me');
  const data = await res.json();
  if (data.authenticated) { currentUser = data; showApp(); }
  else showLogin();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-admin-wrap').classList.remove('hidden');
  document.getElementById('login-team-wrap').classList.add('hidden');
  document.getElementById('signup-form-wrap').classList.add('hidden');
  document.getElementById('login-mode-pick').classList.remove('hidden');
  switchLoginMode('admin');
}

function switchLoginMode(mode) {
  document.getElementById('login-admin-wrap').classList.toggle('hidden', mode !== 'admin');
  document.getElementById('login-team-wrap').classList.toggle('hidden', mode !== 'team');
  document.getElementById('signup-form-wrap').classList.add('hidden');
  document.getElementById('login-mode-pick').classList.remove('hidden');
  document.getElementById('mode-admin-btn').classList.toggle('active', mode === 'admin');
  document.getElementById('mode-team-btn').classList.toggle('active', mode === 'team');
}

function showSignup() {
  document.getElementById('login-mode-pick').classList.add('hidden');
  document.getElementById('login-team-wrap').classList.add('hidden');
  document.getElementById('signup-form-wrap').classList.remove('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadClientLastViewed();
  applyRoleUI();
  loadAll();
}

function applyRoleUI() {
  const isAdmin = currentUser.role === 'admin';
  document.querySelectorAll('.nav-admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
  const name = currentUser.name || 'Admin';
  document.getElementById('sidebar-user-name').textContent = name;
  document.getElementById('sidebar-user-role').textContent = isAdmin ? 'Admin' : 'Team Member';
  document.getElementById('sidebar-user-avatar').textContent = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

document.getElementById('btn-login').addEventListener('click', doAdminLogin);
document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doAdminLogin(); });
document.getElementById('btn-login-team').addEventListener('click', doTeamLogin);
document.getElementById('login-pw-team').addEventListener('keydown', e => { if (e.key === 'Enter') doTeamLogin(); });
document.getElementById('btn-signup').addEventListener('click', doSignup);

async function doAdminLogin() {
  const pw  = document.getElementById('login-pw').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (res.ok) {
    const data = await res.json();
    currentUser = { authenticated: true, role: 'admin', name: data.name || 'Admin', userId: 'admin' };
    showApp();
  } else {
    err.textContent = 'Incorrect password.';
  }
}

async function doTeamLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw-team').value;
  const err   = document.getElementById('login-error-team');
  err.textContent = '';
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  if (res.ok) {
    const data = await res.json();
    currentUser = { authenticated: true, role: data.role || 'member', name: data.name || email, userId: data.userId || '' };
    showApp();
  } else {
    const d = await res.json().catch(() => ({}));
    err.textContent = d.error || 'Invalid email or password.';
  }
}

async function doSignup() {
  const name  = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw    = document.getElementById('signup-pw').value;
  const err   = document.getElementById('signup-error');
  err.textContent = '';
  if (!name || !email || !pw) { err.textContent = 'All fields required.'; return; }
  const res = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: pw }) });
  if (res.ok) {
    err.style.color = 'var(--green)';
    err.textContent = 'Account created! You can now sign in.';
    setTimeout(() => { err.textContent = ''; err.style.color = ''; showLogin(); }, 1800);
  } else {
    const d = await res.json().catch(() => ({}));
    err.textContent = d.error || 'Signup failed.';
  }
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = { authenticated: false, role: 'member', name: '', userId: '' };
  showLogin();
});

/* ── Data Loading ─────────────────────────────────────────────────────────── */
async function loadAll() {
  document.getElementById('loading').classList.remove('hidden');
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));

  const [cRes, tRes, lRes, pRes, aRes, tkRes] = await Promise.all([
    fetch('/api/clients'), fetch('/api/team'), fetch('/api/local'), fetch('/api/programs'), fetch('/api/addons'), fetch('/api/tasks'),
  ]);
  clients    = await cRes.json();
  const teamData = await tRes.json();
  // teamData is now [{id,name,email,role}] — extract names for backward compat
  team       = teamData.map(m => typeof m === 'string' ? m : m.name);
  window._teamFull = teamData; // full objects for Team Management UI
  localStore = await lRes.json();
  programsMap = await pRes.json();
  addonsMap   = await aRes.json();
  myTasks    = await tkRes.json();

  populateAssigneeFilters();
  document.getElementById('loading').classList.add('hidden');
  showTab(activeTab);
}

document.getElementById('btn-refresh').addEventListener('click', loadAll);

/* ── Auto-refresh (silent background poll every 30s) ─────────────────────── */
async function silentRefresh() {
  // Skip if modal open, tab hidden, or user is actively editing
  if (!document.getElementById('client-modal')?.classList.contains('hidden')) return;
  if (document.visibilityState === 'hidden') return;
  try {
    const [cRes, tRes, tkRes] = await Promise.all([
      fetch('/api/clients'), fetch('/api/team'), fetch('/api/tasks'),
    ]);
    if (!cRes.ok || !tRes.ok || !tkRes.ok) return;
    clients = await cRes.json();
    const teamData = await tRes.json();
    team    = teamData.map(m => typeof m === 'string' ? m : m.name);
    window._teamFull = teamData;
    myTasks = await tkRes.json();
    // Re-render current view silently
    renderCurrentTab();
    const t = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const sl = document.getElementById('sync-label');
    if (sl) sl.textContent = `Synced ${t}`;
  } catch { /* network error — silent */ }
}

function renderCurrentTab() {
  if      (activeTab === 'clients')    renderClients();
  else if (activeTab === 'overview')   renderOverview();
  else if (activeTab === 'mydash')     renderMyDash();
  else if (activeTab === 'analytics')  renderAnalytics();
  else if (activeTab === 'programs')   renderPrograms();
  else if (activeTab === 'intake')     renderIntakes();
  else if (activeTab === 'activitylog') renderActivityLog();
}

setInterval(silentRefresh, 30000);

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
  // Sync active class on nav items
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  if      (tab === 'overview')   renderOverview();
  else if (tab === 'clients')    renderClients();
  else if (tab === 'programs')   renderPrograms();
  else if (tab === 'analytics')  renderAnalytics();
  else if (tab === 'intake')     renderIntakes();
  else if (tab === 'team')       renderTeam();
  else if (tab === 'mydash')     renderMyDash();
  else if (tab === 'teamcal')    renderTeamCalendar();
  else if (tab === 'activitylog') renderActivityLog();
  else if (tab === 'help')        renderHelp();
  else if (tab === 'chat')        initChat();
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
    // Default note author to the currently logged-in user
    if (id === 'cm-note-author' && currentUser.name) s.value = currentUser.name;
  });

  // Populate program dropdowns from dynamic programsMap
  const progNames = Object.keys(programsMap);
  const filterProgEl = document.getElementById('filter-program');
  if (filterProgEl) {
    filterProgEl.innerHTML = '<option value="">All Programs</option>';
    progNames.forEach(name => {
      const o = document.createElement('option'); o.value = name; o.textContent = name;
      filterProgEl.appendChild(o);
    });
  }

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
const ACTIVE_STATUSES    = ['Active', 'Onboarding', 'On New Program'];
const COMPLETED_STATUSES = ['Completed'];
const INTAKE_STATUSES    = ['New'];
const HOLD_STATUSES      = ['Alumni', 'Closed'];

function renderOverview() {
  const active    = clients.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
  const intake    = clients.filter(c => INTAKE_STATUSES.includes(c.status)).length;
  const onHold    = clients.filter(c => HOLD_STATUSES.includes(c.status)).length;
  const completed = clients.filter(c => COMPLETED_STATUSES.includes(c.status)).length;

  document.getElementById('kpi-active').textContent     = active;
  document.getElementById('kpi-intake').textContent     = intake;
  document.getElementById('kpi-paused').textContent     = onHold;
  document.getElementById('kpi-completed').textContent  = completed;
  document.getElementById('kpi-active-sub').textContent = `${clients.length} total clients`;
  document.getElementById('overview-subtitle').textContent =
    `${active} active · refreshed ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
  const ovDate = document.getElementById('ov-date-label');
  if (ovDate) ovDate.textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  renderTodaysRead();
  renderDeadlineHealth();
  renderClientHealthBoard('client-health-board', clients.filter(c => !['Closed'].includes(c.status)));
  renderChart('chart-programs', 'doughnut', programChartData());
  renderChart('chart-status',   'doughnut', statusChartData());
}

/* ── Deadline Health Cards ────────────────────────────────────────────────── */
function renderDeadlineHealth() {
  const active = clients.filter(c => ACTIVE_STATUSES.includes(c.status));
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

  const active = clients.filter(c => ACTIVE_STATUSES.includes(c.status));
  const overdue  = active.filter(c => deadlineStatus(c)?.state === 'overdue');
  const delayed  = active.filter(c => deadlineStatus(c)?.state === 'delayed');
  const atRisk   = active.filter(c => deadlineStatus(c)?.state === 'at-risk');
  const newIntakes = clients.filter(c => c.status === 'New');
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

  const levelColor  = { critical: '#f87171', warn: '#fb923c', caution: '#fbbf24', info: '#7dd3fc' };
  const levelBg     = { critical: 'rgba(248,113,113,.09)', warn: 'rgba(224,91,46,.10)', caution: 'rgba(251,191,36,.09)', info: 'rgba(125,211,252,.08)' };
  const levelBorder = { critical: '#f87171', warn: 'var(--accent2)', caution: '#fbbf24', info: '#7dd3fc' };

  el.innerHTML = items.map(item => `
    <div class="tr-item" style="border-left-color:${levelBorder[item.level]};background:${levelBg[item.level]}">
      <div class="tr-item-header">
        <span class="tr-icon">${item.icon}</span>
        <strong style="color:${levelColor[item.level]}">${item.title}</strong>
      </div>
      <div class="tr-item-body">${item.body}</div>
    </div>`).join('');
}

/* ── Client Health Board ──────────────────────────────────────────────────── */
function renderClientHealthBoard(containerId, list) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  const DONE_PROG_STATUSES = ['Completed', 'Cancelled'];
  const DONE_CLIENT_STATUSES = ['Completed', 'Alumni', 'Closed'];
  const stateRank = { overdue: 0, delayed: 1, 'at-risk': 2, 'on-track': 3 };
  const healthColor = { overdue: '#ef4444', delayed: '#f97316', 'at-risk': '#f59e0b', 'on-track': '#4ade80' };
  const healthLabel = { overdue: 'Overdue', delayed: 'Behind', 'at-risk': 'At Risk', 'on-track': 'On Track' };
  const healthBg    = { overdue: 'rgba(239,68,68,.15)', delayed: 'rgba(249,115,22,.15)', 'at-risk': 'rgba(245,158,11,.15)', 'on-track': 'rgba(74,222,128,.12)' };

  // Expand to one row per active program per client
  const rows = [];
  for (const c of list) {
    const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
    const progStatuses  = c.programStatuses  || {};
    const progStartDates = c.programStartDates || {};
    const clientDone = DONE_CLIENT_STATUSES.includes(c.status);

    for (const prog of progs) {
      const ps = progStatuses[prog] || '';
      // Skip programs explicitly marked done
      if (DONE_PROG_STATUSES.includes(ps)) continue;
      // Skip if client is done and this program has no explicit active status
      if (clientDone && !ps) continue;

      const dur   = progDuration(prog) || 1;
      const week  = Math.min((c.programWeeks?.[prog]) || (prog === progs[0] ? c.currentWeek || 1 : 1), dur);
      const pct   = ps === 'Completed' ? 100 : Math.round((week / dur) * 100);
      const color = progColor(prog);
      const phase = getPhaseLabel(prog, week);
      const sd    = progStartDates[prog] || (prog === progs[0] ? c.startDate : null);

      // Compute health for this specific program
      let state = 'on-track', daysLeft = null, gap = 0;
      if (sd) {
        const end = new Date(new Date(sd).getTime() + dur * 7 * 86400000);
        daysLeft = Math.ceil((end - new Date()) / 86400000);
        gap = Math.abs(Math.round((new Date() - end) / (86400000 * 7)));
        if (daysLeft < 0) state = 'overdue';
        else if (daysLeft < 14) state = 'at-risk';
        else if (daysLeft < 21) state = 'delayed';
        else state = 'on-track';
      }

      rows.push({ c, prog, dur, week, pct, color, phase, state, daysLeft, gap, sd });
    }
  }

  if (!rows.length) {
    wrap.innerHTML = '<p style="color:var(--text3);font-size:13px;text-align:center;padding:20px 0">No active programs yet.</p>';
    return;
  }

  // Sort worst state first
  rows.sort((a, b) => (stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9));

  wrap.innerHTML = rows.map(({ c, prog, dur, week, pct, color, phase, state, daysLeft, sd }) => {
    const hColor = healthColor[state] || '#4ade80';
    const hLabel = healthLabel[state] || 'On Track';
    const hBg    = healthBg[state]    || 'rgba(74,222,128,.12)';
    const lead   = c.leadAssignee ? `<span style="font-size:11px;color:var(--text3)">Lead: <span style="color:var(--text2)">${escHtml(c.leadAssignee)}</span></span>` : '';
    const daysInfo = sd && daysLeft !== null
      ? (daysLeft < 0
          ? `<span style="color:#ef4444;font-size:11px">${Math.abs(daysLeft)}d overdue</span>`
          : `<span style="font-size:11px;color:var(--text3)">${daysLeft}d left</span>`)
      : `<span style="font-size:11px;color:var(--text3)">No date set</span>`;

    return `<div class="chb-row" onclick="openModal('${c.id}')">
      <div class="chb-left">
        <div class="chb-avatar">${initials(c.name)}</div>
        <div class="chb-info">
          <div class="chb-name">${escHtml(c.name)}${c.businessName ? `<span class="chb-biz"> · ${escHtml(c.businessName)}</span>` : ''}</div>
          <div class="chb-meta">${escHtml(prog)}${phase ? ` · <span style="color:var(--text3)">${escHtml(phase)}</span>` : ''}${lead ? ' · ' + lead : ''}</div>
        </div>
      </div>
      <div class="chb-progress-wrap">
        <div class="chb-bar-track">
          <div class="chb-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="chb-bar-meta">
          <span style="font-size:11px;color:var(--text3)">Wk ${week}/${dur} · ${pct}%</span>
          ${daysInfo}
        </div>
      </div>
      <div class="chb-status" style="background:${hBg};color:${hColor}">
        <span class="chb-dot" style="background:${hColor}"></span>${hLabel}
      </div>
    </div>`;
  }).join('');
}

/* ── My Dashboard ─────────────────────────────────────────────────────────── */
async function renderMyDash() {
  const name = currentUser.name || '';
  const myClients = clients.filter(c =>
    ACTIVE_STATUSES.includes(c.status) &&
    (c.leadAssignee === name || c.techAssignee === name)
  );

  // Welcome banner
  const first = name.split(' ')[0] || 'there';
  document.getElementById('welcome-text').textContent = `Hi ${first}! Welcome. It's time to work. 💪`;
  document.getElementById('mydash-title').textContent = `${name}'s Dashboard`;
  document.getElementById('mydash-date').textContent  = new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const warn = myClients.filter(c => { const d = deadlineStatus(c); return d && ['overdue','delayed','at-risk'].includes(d.state); }).length;
  const ok   = myClients.filter(c => { const d = deadlineStatus(c); return !d || d.state === 'on-track'; }).length;

  document.getElementById('my-kpi-active').textContent     = myClients.length;
  document.getElementById('my-kpi-warn').textContent       = warn;
  document.getElementById('my-kpi-ok').textContent         = ok;
  document.getElementById('my-kpi-active-sub').textContent = 'as lead or tech';

  renderClientHealthBoard('my-client-health', myClients);
  await renderMyPriorities(myClients);
  await initCalendar(myClients);
  renderMyTasks();
}

async function renderMyPriorities(myClients) {
  const el = document.getElementById('my-priorities');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text3);font-size:12.5px;padding:6px 0">Loading next tasks…</div>';

  const tasks = [];
  for (const c of myClients) {
    const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
    for (const prog of progs) {
      if (!programsMap[prog]) continue;
      const week = (c.programWeeks?.[prog]) || c.currentWeek || 1;
      const def  = getWeekDef(prog, week);
      if (!def || !def.items?.length) continue;
      let fields = {};
      try {
        const r = await fetch(`/api/clients/${c.id}/checklist/${week}?program=${encodeURIComponent(prog)}`);
        if (r.ok) { const d = await r.json(); fields = d.fields || {}; }
      } catch {}
      const ds = deadlineStatus(c);
      const urgency = { overdue: 0, delayed: 1, 'at-risk': 2, 'on-track': 3 }[ds?.state || 'on-track'];
      for (const item of def.items) {
        if (!fields[item.id]) {
          tasks.push({ client: c, prog, week, item, phase: def.phase, urgency, ds });
        }
      }
    }
  }

  if (!tasks.length) {
    el.innerHTML = `<div class="tr-all-good"><span>✅</span><span>All checklist tasks for your clients are complete!</span></div>`;
    return;
  }

  tasks.sort((a, b) => a.urgency - b.urgency);
  const top5 = tasks.slice(0, 5);

  const urgencyColor = { 0: '#ef4444', 1: '#f97316', 2: '#f59e0b', 3: 'var(--text3)' };
  const urgencyIcon  = { 0: '🔴', 1: '🟠', 2: '🟡', 3: '⬜' };

  el.innerHTML = top5.map(t => `
    <div class="priority-task-item" onclick="openModal('${t.client.id}')">
      <div class="priority-task-top">
        <span class="priority-task-icon">${urgencyIcon[t.urgency]}</span>
        <span class="priority-task-client">${escHtml(t.client.name)}</span>
        <span class="priority-task-badge" style="color:${urgencyColor[t.urgency]}">${t.ds?.state === 'overdue' ? 'Overdue' : t.ds?.state === 'delayed' ? 'Behind' : t.ds?.state === 'at-risk' ? 'At Risk' : 'On Track'}</span>
      </div>
      <div class="priority-task-label">${t.prog ? escHtml(t.prog) + ' · ' : ''}Wk ${t.week}${t.phase ? ` · ${escHtml(t.phase)}` : ''}</div>
      <div class="priority-task-task">${escHtml(t.item.label)}</div>
    </div>`).join('');
}

/* ── My Tasks ─────────────────────────────────────────────────────────────── */
const PRIORITY_COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: '#4ade80' };
const PRIORITY_LABEL = { High: 'High', Medium: 'Medium', Low: 'Low' };
const STATUS_CLASS   = { 'To Do': 'ts-todo', 'In Progress': 'ts-inprog', 'Done': 'ts-done' };

function taskDeadlineInfo(t) {
  if (!t.deadline) return { label: '', color: 'var(--text3)' };
  const today = new Date(); today.setHours(0,0,0,0);
  const dl    = new Date(t.deadline + 'T00:00:00');
  const diff  = Math.round((dl - today) / 86400000);
  if (t.status === 'Done') return { label: '✓ Done', color: 'var(--green)' };
  if (diff < 0)   return { label: `${Math.abs(diff)}d overdue`, color: '#ef4444' };
  if (diff === 0) return { label: 'Due today',   color: '#f97316' };
  if (diff <= 3)  return { label: `${diff}d left`, color: '#f59e0b' };
  return { label: dl.toLocaleDateString('en-GB', { day:'numeric', month:'short' }), color: 'var(--text3)' };
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

async function toggleArchivedTasks() {
  showArchivedTasks = !showArchivedTasks;
  const btn = document.getElementById('btn-toggle-archived');
  if (btn) btn.classList.toggle('active', showArchivedTasks);
  if (showArchivedTasks) {
    const res = await fetch('/api/tasks?archived=true');
    if (res.ok) myTasks = await res.json();
  } else {
    const res = await fetch('/api/tasks');
    if (res.ok) myTasks = await res.json();
  }
  renderMyTasks();
}

function renderMyTasks() {
  const el = document.getElementById('my-tasks-list');
  if (!el) return;
  const statusF   = document.getElementById('task-filter-status')?.value   || '';
  const priorityF = document.getElementById('task-filter-priority')?.value || '';

  let list = [...myTasks];
  if (!showArchivedTasks) list = list.filter(t => !t.archived);
  if (statusF)   list = list.filter(t => t.status   === statusF);
  if (priorityF) list = list.filter(t => t.priority === priorityF);

  if (!list.length) {
    el.innerHTML = showArchivedTasks
      ? `<div class="task-empty">No archived tasks.</div>`
      : `<div class="task-empty">No tasks yet — hit <strong>+ New Task</strong> to get started.</div>`;
    return;
  }

  el.innerHTML = list.map(t => {
    const client = t.clientId ? clients.find(c => c.id === t.clientId) : null;
    const dl     = taskDeadlineInfo(t);
    const avatars = (t.assignedTo || []).slice(0,3).map(n =>
      `<span class="task-avatar" title="${escHtml(n)}" style="background:${stringToColor(n)}">${initials(n)}</span>`
    ).join('');
    return `<div class="task-row${t.archived?' task-row-archived':''}" onclick="openTaskModal('${t.id}')">
      <div class="task-row-name">
        <span class="task-row-stripe" style="background:${PRIORITY_COLOR[t.priority]||'#8A7A6E'}"></span>
        <div class="task-row-info">
          <span class="task-row-title">${escHtml(t.title)}${t.archived?' <span class="task-archived-banner">Archived</span>':''}</span>
          ${client ? `<span class="task-row-client">🔗 ${escHtml(client.name)}</span>` : ''}
        </div>
      </div>
      <div class="task-row-col task-avatars">${avatars || '<span style="color:var(--text3);font-size:11px">—</span>'}</div>
      <div class="task-row-col">
        <span class="task-priority-pill" style="color:${PRIORITY_COLOR[t.priority]||'#8A7A6E'};background:${PRIORITY_COLOR[t.priority]||'#8A7A6E'}18">
          ${PRIORITY_LABEL[t.priority]||t.priority}
        </span>
      </div>
      <div class="task-row-col" style="color:${dl.color};font-size:12px;font-weight:${dl.color!=='var(--text3)'?'600':'400'}">${dl.label||'—'}</div>
      <div class="task-row-col"><span class="task-status-pill ${STATUS_CLASS[t.status]||''}">${t.status}</span></div>
    </div>`;
  }).join('');
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h},45%,35%)`;
}

document.getElementById('task-filter-status')?.addEventListener('change', renderMyTasks);
document.getElementById('task-filter-priority')?.addEventListener('change', renderMyTasks);

function openTaskModal(taskId) {
  editingTaskId = taskId || null;
  const t       = taskId ? myTasks.find(x => x.id === taskId) : null;
  const isAdmin = currentUser.role === 'admin';
  const myName  = currentUser.name || '';

  document.getElementById('task-title').value    = t?.title       || '';
  document.getElementById('task-desc').value     = t?.description || '';
  document.getElementById('task-priority').value = t?.priority    || 'Medium';
  document.getElementById('task-deadline').value = t?.deadline    || '';
  document.getElementById('task-status').value   = t?.status      || 'To Do';

  const clientSel = document.getElementById('task-client');
  clientSel.innerHTML = '<option value="">— No client —</option>' +
    clients.map(c => `<option value="${c.id}" ${t?.clientId===c.id?'selected':''}>${escHtml(c.name)}${c.businessName?' – '+escHtml(c.businessName):''}</option>`).join('');

  const renderMemberPicks = (containerId, selected) => {
    const all = [...new Set([...team, myName])].filter(Boolean);
    document.getElementById(containerId).innerHTML = all.map(m => {
      const checked = selected.includes(m);
      return `<label class="tdp-member-chip ${checked?'checked':''}">
        <input type="checkbox" value="${escHtml(m)}" ${checked?'checked':''} onchange="this.closest('label').classList.toggle('checked',this.checked)">
        <span class="tdp-member-av" style="background:${stringToColor(m)}">${initials(m)}</span>
        <span>${escHtml(m)}</span>
      </label>`;
    }).join('');
  };
  renderMemberPicks('task-assignees', t?.assignedTo || [myName]);
  renderMemberPicks('task-shared',    t?.sharedWith || []);

  document.getElementById('task-assign-wrap').style.display = '';

  const canDelete  = isAdmin || (t && t.createdBy === myName);
  const canArchive = t && (isAdmin || t.createdBy === myName ||
    (t.assignedTo||[]).includes(myName) || (t.sharedWith||[]).includes(myName));
  document.getElementById('task-delete-btn').classList.toggle('hidden', !t || !canDelete);
  const archiveBtn = document.getElementById('task-archive-btn');
  if (archiveBtn) {
    archiveBtn.classList.toggle('hidden', !canArchive);
    archiveBtn.textContent = t?.archived ? 'Unarchive' : 'Archive';
  }

  renderTaskActivity(t);

  document.getElementById('task-modal').classList.remove('hidden');
  document.getElementById('task-title').focus();
}

function renderTaskActivity(t) {
  const feed = document.getElementById('task-activity-feed');
  if (!feed) return;
  const comments = t?.comments || [];
  const created  = t?.createdAt;

  let items = [];
  if (created) items.push({ ts: created, type: 'system', text: `Task created by <strong>${escHtml(t.createdBy||'Team')}</strong>` });
  comments.forEach(c => items.push({ ts: c.ts, type: 'comment', text: escHtml(c.text), author: c.author }));
  items.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  if (!items.length) {
    feed.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:12px 0">No activity yet.</div>';
    return;
  }
  feed.innerHTML = items.map(item => {
    const time = new Date(item.ts).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) +
                 ' ' + new Date(item.ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    if (item.type === 'system') {
      return `<div class="tda-system"><span>${item.text}</span><span class="tda-time">${time}</span></div>`;
    }
    return `<div class="tda-comment">
      <span class="tda-av" style="background:${stringToColor(item.author)}">${initials(item.author)}</span>
      <div class="tda-body">
        <div class="tda-author">${escHtml(item.author)} <span class="tda-time">${time}</span></div>
        <div class="tda-text">${item.text.replace(/\n/g,'<br>')}</div>
      </div>
    </div>`;
  }).join('');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) { document.getElementById('task-title').focus(); return; }

  const isAdmin = currentUser.role === 'admin';
  const myName  = currentUser.name || '';
  const getChecked = id => [...document.getElementById(id).querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
  const assignedTo = getChecked('task-assignees');
  const sharedWith = getChecked('task-shared');

  const payload = {
    title,
    description: document.getElementById('task-desc').value.trim(),
    priority:    document.getElementById('task-priority').value,
    status:      document.getElementById('task-status').value,
    deadline:    document.getElementById('task-deadline').value,
    clientId:    document.getElementById('task-client').value,
    assignedTo,
    sharedWith,
  };

  const url    = editingTaskId ? `/api/tasks/${editingTaskId}` : '/api/tasks';
  const method = editingTaskId ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) return;
  const saved = await res.json();

  if (editingTaskId) {
    const idx = myTasks.findIndex(t => t.id === editingTaskId);
    if (idx !== -1) myTasks[idx] = saved; else myTasks.push(saved);
  } else {
    myTasks.push(saved);
  }
  closeTaskModal();
  renderMyTasks();
}

async function deleteTask() {
  if (!editingTaskId) return;
  const t = myTasks.find(x => x.id === editingTaskId);
  if (!confirm(`Delete "${t?.title}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/tasks/${editingTaskId}`, { method: 'DELETE' });
  if (!res.ok) return;
  myTasks = myTasks.filter(x => x.id !== editingTaskId);
  closeTaskModal();
  renderMyTasks();
}

async function archiveTask() {
  if (!editingTaskId) return;
  const t = myTasks.find(x => x.id === editingTaskId);
  if (!t) return;
  const newArchived = !t.archived;
  const res = await fetch(`/api/tasks/${editingTaskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: newArchived }),
  });
  if (!res.ok) return;
  const saved = await res.json();
  const idx = myTasks.findIndex(x => x.id === editingTaskId);
  if (idx !== -1) myTasks[idx] = saved;
  closeTaskModal();
  if (!showArchivedTasks) myTasks = myTasks.filter(x => !x.archived);
  renderMyTasks();
}

async function postTaskComment() {
  if (!editingTaskId) return;
  const input = document.getElementById('task-comment-input');
  const text  = input?.value.trim();
  if (!text) return;
  const res = await fetch(`/api/tasks/${editingTaskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return;
  const data = await res.json();
  const idx  = myTasks.findIndex(t => t.id === editingTaskId);
  if (idx !== -1) myTasks[idx] = data.task;
  if (input) input.value = '';
  renderTaskActivity(data.task);
  renderMyTasks();
}

/* ── Calendar ─────────────────────────────────────────────────────────────── */
let calYear, calMonth, calEntries = [], calSelectedDate = null, calMyClients = [];

function toYMD(d) { return d.toISOString().slice(0,10); }

async function initCalendar(myClients) {
  calMyClients = myClients;
  const now = new Date();
  if (!calYear) { calYear = now.getFullYear(); calMonth = now.getMonth(); }
  calEntries = await fetchCalendarEntries(calYear, calMonth);
  renderCalendar();
  // default select today
  const todayStr = toYMD(now);
  selectCalDay(todayStr);
}

async function fetchCalendarEntries(year, month) {
  const from = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const last = new Date(year, month+1, 0);
  const to   = toYMD(last);
  const res  = await fetch(`/api/calendar?from=${from}&to=${to}`);
  return res.ok ? res.json() : [];
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  fetchCalendarEntries(calYear, calMonth).then(e => { calEntries = e; renderCalendar(); });
}

function renderCalendar() {
  const label = new Date(calYear, calMonth, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  document.getElementById('cal-month-label').textContent = label;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const todayStr = toYMD(new Date());

  // Build map of date → entries count
  const entryMap = {};
  calEntries.forEach(e => { entryMap[e.date] = (entryMap[e.date] || 0) + 1; });
  // Build map of date → has deliverables (client week start)
  const delivMap = {};
  calMyClients.forEach(c => {
    if (!c.startDate || !c.program) return;
    const start = new Date(c.startDate);
    if (isNaN(start)) return;
    const dur = progDuration(c.program);
    for (let w = 1; w <= dur; w++) {
      const weekStart = new Date(start.getTime() + (w-1)*7*24*60*60*1000);
      const d = toYMD(weekStart);
      if (d.startsWith(`${calYear}-${String(calMonth+1).padStart(2,'0')}`)) {
        delivMap[d] = (delivMap[d] || 0) + 1;
      }
    }
  });

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-cell-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = dateStr === todayStr;
    const isSelected = dateStr === calSelectedDate;
    const hasEntry   = entryMap[dateStr] > 0;
    const hasDeliv   = delivMap[dateStr] > 0;
    html += `<div class="cal-cell${isToday?' cal-today':''}${isSelected?' cal-selected':''}" onclick="selectCalDay('${dateStr}')">
      <span class="cal-day-num">${d}</span>
      <div class="cal-dots">
        ${hasEntry ? '<span class="cal-dot cal-dot-log"></span>' : ''}
        ${hasDeliv ? '<span class="cal-dot cal-dot-deliv"></span>' : ''}
      </div>
    </div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

function selectCalDay(dateStr) {
  calSelectedDate = dateStr;
  renderCalendar();
  const panel     = document.getElementById('cal-day-panel');
  const titleEl   = document.getElementById('cal-day-panel-title');
  const entriesEl = document.getElementById('cal-day-entries');
  const addRow    = document.getElementById('cal-add-row');
  const d = new Date(dateStr + 'T00:00:00');
  titleEl.textContent = d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' });
  addRow.style.display = 'flex';

  // Entries for this day
  const dayEntries = calEntries.filter(e => e.date === dateStr);
  // Deliverables for this day
  const dayDelivs = [];
  calMyClients.forEach(c => {
    if (!c.startDate || !c.program) return;
    const start = new Date(c.startDate);
    if (isNaN(start)) return;
    const dur = progDuration(c.program);
    for (let w = 1; w <= dur; w++) {
      const weekStart = toYMD(new Date(start.getTime() + (w-1)*7*24*60*60*1000));
      if (weekStart === dateStr) {
        const def = getWeekDef(c.program, w);
        dayDelivs.push({ client: c.name, week: w, items: def?.items || [], phase: def?.phase || '' });
      }
    }
  });

  let html = '';
  if (!dayEntries.length && !dayDelivs.length) {
    html = '<div class="cal-no-entries">No entries yet. Log what you worked on today.</div>';
  }
  dayEntries.forEach(e => {
    html += `<div class="cal-entry-item">
      <div class="cal-entry-text">${escHtml(e.text)}</div>
      <button class="cal-entry-del" onclick="deleteCalEntry('${e.id}')">✕</button>
    </div>`;
  });
  dayDelivs.forEach(d => {
    html += `<div class="cal-deliv-block">
      <div class="cal-deliv-title">📋 ${escHtml(d.client)} — Wk ${d.week}${d.phase ? ` · ${escHtml(d.phase)}` : ''}</div>
      ${d.items.length ? d.items.map(i => `<div class="cal-deliv-item">· ${escHtml(i.label)}</div>`).join('') : '<div class="cal-deliv-item" style="color:var(--text3)">No checklist items defined.</div>'}
    </div>`;
  });
  entriesEl.innerHTML = html;
}

async function submitCalEntry() {
  const text = document.getElementById('cal-entry-text').value.trim();
  if (!text) return;
  const res = await fetch('/api/calendar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date: calSelectedDate, text, type: 'log' }) });
  if (res.ok) {
    const entry = await res.json();
    calEntries.push(entry);
    document.getElementById('cal-entry-text').value = '';
    renderCalendar();
    selectCalDay(calSelectedDate);
  }
}

async function deleteCalEntry(id) {
  const res = await fetch(`/api/calendar/${id}`, { method:'DELETE' });
  if (res.ok) {
    calEntries = calEntries.filter(e => e.id !== id);
    renderCalendar();
    selectCalDay(calSelectedDate);
  }
}

/* ── Team Calendar (admin-only tab) ───────────────────────────────────────── */
let teamCalYear, teamCalMonth, teamCalEntries = [];

async function renderTeamCalendar() {
  const now = new Date();
  if (!teamCalYear) { teamCalYear = now.getFullYear(); teamCalMonth = now.getMonth(); }
  teamCalEntries = await fetchTeamCalEntries(teamCalYear, teamCalMonth);
  paintTeamCal();
}

async function fetchTeamCalEntries(year, month) {
  const from = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const to   = toYMD(new Date(year, month+1, 0));
  const res  = await fetch(`/api/calendar?from=${from}&to=${to}`);
  return res.ok ? res.json() : [];
}

function teamCalNav(dir) {
  teamCalMonth += dir;
  if (teamCalMonth > 11) { teamCalMonth = 0; teamCalYear++; }
  if (teamCalMonth < 0)  { teamCalMonth = 11; teamCalYear--; }
  fetchTeamCalEntries(teamCalYear, teamCalMonth).then(e => { teamCalEntries = e; paintTeamCal(); });
}

function paintTeamCal() {
  const label = new Date(teamCalYear, teamCalMonth, 1).toLocaleDateString('en-AU', { month:'long', year:'numeric' });
  document.getElementById('teamcal-month-label').textContent = label;
  const firstDay    = new Date(teamCalYear, teamCalMonth, 1).getDay();
  const daysInMonth = new Date(teamCalYear, teamCalMonth+1, 0).getDate();
  const todayStr    = toYMD(new Date());

  const entryMap = {};
  teamCalEntries.forEach(e => { if (!entryMap[e.date]) entryMap[e.date] = []; entryMap[e.date].push(e); });

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-cell-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${teamCalYear}-${String(teamCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = dateStr === todayStr;
    const isSelected = dateStr === teamCalSelectedDate;
    const dayEntries = entryMap[dateStr] || [];
    const memberSet  = [...new Set(dayEntries.map(e => e.userName))];
    const dots = memberSet.slice(0, 4).map(() => '<span class="cal-dot cal-dot-log"></span>').join('');
    const countBadge = dayEntries.length ? `<span class="cal-entry-count">${dayEntries.length}</span>` : '';
    html += `<div class="cal-cell${isToday?' cal-today':''}${isSelected?' cal-selected':''}${dayEntries.length?' cal-has-entries':''}" onclick="openTeamCalDay('${dateStr}')">
      <span class="cal-day-num">${d}</span>
      <div class="cal-dots">${dots}${countBadge}</div>
    </div>`;
  }
  document.getElementById('teamcal-grid').innerHTML = html;

  const total = teamCalEntries.length;
  document.getElementById('teamcal-subtitle').textContent = `${total} entr${total === 1 ? 'y' : 'ies'} this month`;
}

let teamCalSelectedDate = null;

function openTeamCalDay(dateStr) {
  teamCalSelectedDate = dateStr;
  paintTeamCal(); // re-render to show selected state
  const dayEntries = teamCalEntries.filter(e => e.date === dateStr);
  const d = new Date(dateStr + 'T00:00:00');
  const title = d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  document.getElementById('teamcal-day-title').textContent = title;
  document.getElementById('teamcal-day-count').textContent =
    dayEntries.length ? `${dayEntries.length} entr${dayEntries.length === 1 ? 'y' : 'ies'} from ${[...new Set(dayEntries.map(e => e.userName))].length} team member${[...new Set(dayEntries.map(e => e.userName))].length === 1 ? '' : 's'}` : '';

  const entriesEl = document.getElementById('teamcal-day-entries');
  if (!dayEntries.length) {
    entriesEl.innerHTML = '<div class="cal-no-entries">No team entries logged for this day.</div>';
    return;
  }
  const byMember = {};
  dayEntries.forEach(e => {
    if (!byMember[e.userName]) byMember[e.userName] = [];
    byMember[e.userName].push(e);
  });
  entriesEl.innerHTML = Object.entries(byMember).map(([name, entries]) => `
    <div class="teamcal-member-group">
      <div class="teamcal-member-name">${escHtml(name)}</div>
      ${entries.map(e => `
        <div class="teamcal-entry-row">
          <div class="teamcal-entry-text">${escHtml(e.text)}</div>
          <div class="teamcal-entry-time">${fmtTs(e.createdAt)}</div>
        </div>`).join('')}
    </div>`).join('');
}

/* ── Activity Log ─────────────────────────────────────────────────────────── */
let actlogData = [];
let actlogUserFilter = '';
let actlogActionFilter = '';

/* ── Help & Support ───────────────────────────────────────────────────────── */
function renderHelp() {
  const content = document.getElementById('help-content');
  if (content) content.scrollTop = 0;
  const input = document.getElementById('help-search');
  if (input) input.value = '';
  const clearBtn = document.getElementById('help-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  showAllHelpSections();

  // Sidenav scroll-spy
  if (content && !content._helpSpyBound) {
    content._helpSpyBound = true;
    content.addEventListener('scroll', () => {
      const sections = content.querySelectorAll('.help-section');
      let active = null;
      sections.forEach(s => {
        if (s.getBoundingClientRect().top - content.getBoundingClientRect().top < 80) active = s.id;
      });
      document.querySelectorAll('.help-nav-link').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + active);
      });
    });
  }
}

function filterHelp(query) {
  const clearBtn = document.getElementById('help-search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !query.trim());

  if (!query.trim()) { showAllHelpSections(); return; }

  const q = query.toLowerCase();
  let anyVisible = false;

  document.querySelectorAll('.help-section').forEach(section => {
    let sectionVisible = false;
    section.querySelectorAll('.help-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      const match = text.includes(q);
      card.style.display = match ? '' : 'none';
      if (match) sectionVisible = true;
    });
    section.style.display = sectionVisible ? '' : 'none';
    if (sectionVisible) anyVisible = true;
  });

  const noResults = document.getElementById('help-no-results');
  if (noResults) noResults.classList.toggle('hidden', anyVisible);
}

function clearHelpSearch() {
  const input = document.getElementById('help-search');
  if (input) { input.value = ''; input.focus(); }
  showAllHelpSections();
  const clearBtn = document.getElementById('help-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
}

function showAllHelpSections() {
  document.querySelectorAll('.help-section').forEach(s => s.style.display = '');
  document.querySelectorAll('.help-card').forEach(c => c.style.display = '');
  const noResults = document.getElementById('help-no-results');
  if (noResults) noResults.classList.add('hidden');
}

// Accordion toggle — delegated so it works after any render
document.addEventListener('click', e => {
  const q = e.target.closest('.help-card-q');
  if (q) { const card = q.closest('.help-card'); if (card) card.classList.toggle('open'); return; }

  // Sidenav smooth scroll
  const navLink = e.target.closest('.help-nav-link');
  if (navLink) {
    e.preventDefault();
    const targetId = navLink.getAttribute('href')?.slice(1);
    const target   = document.getElementById(targetId);
    const content  = document.getElementById('help-content');
    if (target && content) content.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
    document.querySelectorAll('.help-nav-link').forEach(a => a.classList.remove('active'));
    navLink.classList.add('active');
  }
});

/* ── Chat ─────────────────────────────────────────────────────────────────── */
let chatCurrentRoom  = 'general';
let chatPollInterval = null;
let chatSinceTs      = null;
let chatRooms        = [];
let chatMessages     = [];
let chatLastRead     = {}; // roomId → last-read ISO ts (localStorage)
let chatReadCount    = {}; // roomId → message count at last read (localStorage)

function chatLoadLastRead() {
  try { chatLastRead  = JSON.parse(localStorage.getItem('chatLastRead')  || '{}'); } catch { chatLastRead  = {}; }
  try { chatReadCount = JSON.parse(localStorage.getItem('chatReadCount') || '{}'); } catch { chatReadCount = {}; }
}
function chatSaveLastRead(roomId, ts) {
  chatLastRead[roomId] = ts;
  try { localStorage.setItem('chatLastRead', JSON.stringify(chatLastRead)); } catch {}
}
function markRoomRead(roomId) {
  const room = chatRooms.find(r => r.id === roomId);
  if (!room) return;
  if (room.lastMessage) chatSaveLastRead(roomId, room.lastMessage.ts);
  chatReadCount[roomId] = room.messageCount || 0;
  try { localStorage.setItem('chatReadCount', JSON.stringify(chatReadCount)); } catch {}
}
function unreadCount(room) {
  return Math.max(0, (room.messageCount || 0) - (chatReadCount[room.id] || 0));
}

function dmRoomId(a, b) { return 'dm__' + [a, b].sort().join('__'); }

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>');
}

async function initChat() {
  chatLoadLastRead();
  await loadChatRooms();
  await loadChatMessages(chatCurrentRoom);
  startChatPolling();
}

async function loadChatRooms() {
  try {
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    chatRooms = await res.json();
    renderChatSidebar();
  } catch(e) { console.error('chat rooms load failed', e); }
}

function renderChatSidebar() {
  const channels = chatRooms.filter(r => r.type === 'channel');
  const dms      = chatRooms.filter(r => r.type === 'dm');
  const myName   = currentUser.name || '';

  // Build team list for new DM (people not already in DM list)
  const dmNames  = dms.map(r => r.name);
  const newDmTargets = team.filter(t => t !== myName && !dmNames.includes(t));

  // Auto-mark active room as read while viewing it
  const activeRoom = chatRooms.find(r => r.id === chatCurrentRoom);
  if (activeRoom) markRoomRead(chatCurrentRoom);

  document.getElementById('chat-channels-list').innerHTML = channels.map(r => {
    const uc = unreadCount(r);
    return `<button class="chat-room-btn ${chatCurrentRoom === r.id ? 'active' : ''}" onclick="switchChatRoom('${r.id}')">
      <span class="chat-room-icon">#</span>
      <span class="chat-room-label">${escHtml(r.name)}</span>
      ${uc > 0 ? `<span class="chat-unread-count">${uc > 99 ? '99+' : uc}</span>` : ''}
    </button>`;
  }).join('');

  document.getElementById('chat-dm-list').innerHTML =
    dms.map(r => {
      const uc = unreadCount(r);
      return `<button class="chat-room-btn ${chatCurrentRoom === r.id ? 'active' : ''}" onclick="switchChatRoom('${r.id}')">
        <span class="chat-dm-av" style="background:${stringToColor(r.name)}">${initials(r.name)}</span>
        <span class="chat-room-label">${escHtml(r.name)}</span>
        ${uc > 0 ? `<span class="chat-unread-count">${uc > 99 ? '99+' : uc}</span>` : ''}
      </button>`;
    }).join('') +
    (newDmTargets.length ? `<div class="chat-new-dm-wrap">${newDmTargets.map(name => `
      <button class="chat-new-dm-btn" onclick="startDm('${escHtml(name)}')" title="Message ${escHtml(name)}">
        <span class="chat-dm-av" style="background:${stringToColor(name)}">${initials(name)}</span>
        <span class="chat-room-label" style="color:var(--text3)">${escHtml(name)}</span>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">+</span>
      </button>`).join('')}</div>` : '');

  // Global unread badge on nav — show total unread count
  const totalUnread = chatRooms.reduce((sum, r) => sum + unreadCount(r), 0);
  const badge = document.getElementById('chat-unread-badge');
  if (badge) {
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function hasUnread(room) {
  return unreadCount(room) > 0;
}

async function switchChatRoom(roomId) {
  chatCurrentRoom = roomId;
  chatSinceTs     = null;
  chatMessages    = [];
  renderChatSidebar();
  updateChatHeader();
  document.getElementById('chat-messages').innerHTML = '<div class="chat-loading">Loading…</div>';
  document.getElementById('chat-input').placeholder =
    roomId === 'general' ? 'Message #general… (Enter to send)' :
    `Message ${chatRooms.find(r=>r.id===roomId)?.name||''}…`;
  await loadChatMessages(roomId);
}

function updateChatHeader() {
  const room = chatRooms.find(r => r.id === chatCurrentRoom);
  const nameEl = document.getElementById('chat-room-name');
  const metaEl = document.getElementById('chat-room-meta');
  if (!room) return;
  if (room.type === 'channel') {
    nameEl.innerHTML = `<span style="color:var(--text3)">#</span> ${escHtml(room.name)}`;
    metaEl.textContent = 'Team channel';
  } else {
    nameEl.innerHTML = `<span class="chat-dm-av" style="background:${stringToColor(room.name)};width:20px;height:20px;font-size:8px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;margin-right:6px">${initials(room.name)}</span>${escHtml(room.name)}`;
    metaEl.textContent = 'Direct message';
  }
}

async function loadChatMessages(roomId) {
  try {
    const url = `/api/chat/${encodeURIComponent(roomId)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    chatMessages = data.messages || [];
    if (chatMessages.length) {
      chatSinceTs = chatMessages[chatMessages.length - 1].ts;
    }
    markRoomRead(roomId);
    renderChatMessages();
    scrollChatToBottom(true);
    updateChatHeader();
  } catch(e) { console.error('chat load failed', e); }
}

function renderChatMessages() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  if (!chatMessages.length) {
    el.innerHTML = '<div class="chat-empty">No messages yet. Say something!</div>';
    return;
  }

  let html = '';
  let prevAuthor = null;
  let prevDateStr = null;

  chatMessages.forEach(msg => {
    const d = new Date(msg.ts);
    const dateStr = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
    const timeStr = d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const isMe    = msg.author === (currentUser.name || '');

    if (dateStr !== prevDateStr) {
      html += `<div class="chat-day-divider"><span>${dateStr}</span></div>`;
      prevAuthor  = null;
      prevDateStr = dateStr;
    }

    const grouped = msg.author === prevAuthor;
    prevAuthor = msg.author;

    if (grouped) {
      html += `<div class="chat-msg chat-msg-grouped ${isMe ? 'chat-msg-me' : ''}">
        <div class="chat-msg-spacer"></div>
        <div class="chat-msg-content">
          <div class="chat-bubble">${linkify(msg.text)}</div>
          <span class="chat-msg-time">${timeStr}</span>
        </div>
      </div>`;
    } else {
      html += `<div class="chat-msg ${isMe ? 'chat-msg-me' : ''}">
        <div class="chat-msg-av" style="background:${stringToColor(msg.author)}">${initials(msg.author)}</div>
        <div class="chat-msg-content">
          <div class="chat-msg-meta">
            <span class="chat-msg-author">${escHtml(msg.author)}</span>
            <span class="chat-msg-time">${timeStr}</span>
          </div>
          <div class="chat-bubble">${linkify(msg.text)}</div>
        </div>
      </div>`;
    }
  });

  el.innerHTML = html;
}

function scrollChatToBottom(instant) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text  = input?.value.trim();
  if (!text) return;
  input.value = '';
  chatInputResize(input);

  try {
    const res = await fetch(`/api/chat/${encodeURIComponent(chatCurrentRoom)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const msg = await res.json();
    chatMessages.push(msg);
    chatSinceTs = msg.ts;
    renderChatMessages();
    scrollChatToBottom(false);
    // Refresh sidebar last-message preview + auto-marks active room as read
    await loadChatRooms();
  } catch(e) { console.error('send failed', e); }
}

function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function chatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function startChatPolling() {
  stopChatPolling();
  chatPollInterval = setInterval(async () => {
    if (activeTab !== 'chat') return;
    try {
      const url = `/api/chat/${encodeURIComponent(chatCurrentRoom)}${chatSinceTs ? '?since=' + encodeURIComponent(chatSinceTs) : ''}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const newMsgs = data.messages || [];
      if (newMsgs.length) {
        chatMessages.push(...newMsgs);
        chatSinceTs = newMsgs[newMsgs.length - 1].ts;
        chatSaveLastRead(chatCurrentRoom, chatSinceTs);
        const el = document.getElementById('chat-messages');
        const nearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
        renderChatMessages();
        if (nearBottom) scrollChatToBottom(false);
      }
      // Poll sidebar for unread dots on other rooms
      await loadChatRooms();
    } catch {}
  }, 3000);
}

function stopChatPolling() {
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
}

// Stop polling when switching away from chat tab
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab !== 'chat') stopChatPolling();
  });
});

async function startDm(name) {
  const res = await fetch('/api/chat/dm/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ withUser: name }),
  });
  if (!res.ok) return;
  const data = await res.json();
  await loadChatRooms();
  await switchChatRoom(data.roomId);
}

async function renderActivityLog() {
  const listEl = document.getElementById('actlog-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="note-empty">Loading…</div>';

  try {
    const res = await fetch('/api/activity');
    actlogData = res.ok ? await res.json() : [];
  } catch { actlogData = []; }

  // Populate user filter
  const userSel = document.getElementById('actlog-filter-user');
  const seen = new Set();
  actlogData.forEach(e => {
    if (!seen.has(e.userId)) {
      seen.add(e.userId);
      if (!userSel.querySelector(`option[value="${e.userId}"]`)) {
        const opt = document.createElement('option');
        opt.value = e.userId; opt.textContent = e.userName;
        userSel.appendChild(opt);
      }
    }
  });

  userSel.onchange = () => { actlogUserFilter = userSel.value; paintActivityLog(); };
  document.getElementById('actlog-filter-action').onchange = function() { actlogActionFilter = this.value; paintActivityLog(); };

  paintActivityLog();
}

function paintActivityLog() {
  const listEl = document.getElementById('actlog-list');
  let data = actlogData;
  if (actlogUserFilter)   data = data.filter(e => e.userId === actlogUserFilter);
  if (actlogActionFilter) data = data.filter(e => e.action.includes(actlogActionFilter));

  document.getElementById('actlog-subtitle').textContent = `${data.length} event${data.length !== 1 ? 's' : ''} logged`;

  if (!data.length) { listEl.innerHTML = '<div class="note-empty">No activity logged yet.</div>'; return; }

  const ACTION_ICON = {
    'Client created': '🟢', 'Client updated': '✏️', 'Client deleted': '🗑️',
    'Task checked': '✅', 'Task unchecked': '⬜', 'Task note saved': '📝',
    'Add-on task checked': '✅', 'Add-on task unchecked': '⬜', 'Add-on task note saved': '📝',
    'Note added': '💬', 'Calendar entry added': '📅',
    'Team member added': '👤', 'Team member removed': '❌', 'Team role changed': '🔄',
  };

  listEl.innerHTML = data.map(e => `
    <div class="actlog-row" ${e.clientId ? `onclick="openClientById('${e.clientId}')" style="cursor:pointer"` : ''}>
      <div class="actlog-icon">${ACTION_ICON[e.action] || '📋'}</div>
      <div class="actlog-body">
        <div class="actlog-top">
          <span class="actlog-action">${escHtml(e.action)}</span>
          ${e.clientName ? `<span class="actlog-client">· ${escHtml(e.clientName)}</span>` : ''}
          <span class="actlog-time">${fmtTs(e.ts)}</span>
        </div>
        <div class="actlog-who">by <strong>${escHtml(e.userName)}</strong></div>
        ${e.details ? `<div class="actlog-details">${escHtml(e.details)}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderClientActivityLog(clientId) {
  const el = document.getElementById('client-actlog-list');
  if (!el) return;
  const log = (clients.find(c => c.id === clientId)?.activityLog) || [];
  if (!log.length) { el.innerHTML = '<div class="note-empty">No activity logged yet.</div>'; return; }
  const ACTION_ICON = {
    'Client created': '🟢', 'Client updated': '✏️', 'Task checked': '✅',
    'Task unchecked': '⬜', 'Task note saved': '📝', 'Add-on task checked': '✅',
    'Add-on task unchecked': '⬜', 'Add-on task note saved': '📝', 'Note added': '💬',
  };
  el.innerHTML = log.map(e => `
    <div class="actlog-row">
      <div class="actlog-icon">${ACTION_ICON[e.action] || '📋'}</div>
      <div class="actlog-body">
        <div class="actlog-top">
          <span class="actlog-action">${escHtml(e.action)}</span>
          <span class="actlog-time">${fmtTs(e.ts)}</span>
        </div>
        <div class="actlog-who">by <strong>${escHtml(e.userName)}</strong></div>
        ${e.details ? `<div class="actlog-details">${escHtml(e.details)}</div>` : ''}
      </div>
    </div>`).join('');
}

async function renderUserActivityLog(userId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div class="note-empty">Loading…</div>';
  try {
    const res = await fetch(`/api/activity/user/${userId}`);
    const log = res.ok ? await res.json() : [];
    if (!log.length) { el.innerHTML = '<div class="note-empty">No activity yet.</div>'; return; }
    const ACTION_ICON = { 'Client created':'🟢','Client updated':'✏️','Task checked':'✅','Task unchecked':'⬜','Task note saved':'📝','Add-on task checked':'✅','Add-on task unchecked':'⬜','Add-on task note saved':'📝','Note added':'💬','Calendar entry added':'📅','Team member added':'👤','Team member removed':'❌','Team role changed':'🔄' };
    el.innerHTML = log.map(e => `
      <div class="actlog-row" ${e.clientId ? `onclick="openClientById('${e.clientId}')" style="cursor:pointer"` : ''}>
        <div class="actlog-icon">${ACTION_ICON[e.action] || '📋'}</div>
        <div class="actlog-body">
          <div class="actlog-top">
            <span class="actlog-action">${escHtml(e.action)}</span>
            ${e.clientName ? `<span class="actlog-client">· ${escHtml(e.clientName)}</span>` : ''}
            <span class="actlog-time">${fmtTs(e.ts)}</span>
          </div>
          ${e.details ? `<div class="actlog-details">${escHtml(e.details)}</div>` : ''}
        </div>
      </div>`).join('');
  } catch { el.innerHTML = '<div class="note-empty">Could not load.</div>'; }
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
  const colors = { New: '#7A52A0', Onboarding: '#C4522A', Active: '#2E7D5E', 'On New Program': '#4A7C5C', Completed: '#3B6B9A', Alumni: '#B07A28', Closed: '#5A5A5A', Unknown: '#8A7A6E' };
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
    const cid   = c.id;
    const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);

    const statusOpts = ['New','Onboarding','Active','On New Program','Completed','Alumni','Closed']
      .map(s => `<option value="${s}" ${c.status===s?'selected':''}>${s}</option>`).join('');
    const teamOpts = (sel) => `<option value="">—</option>` +
      team.map(t => `<option value="${t}" ${sel===t?'selected':''}>${t}</option>`).join('');

    const programBadges = progs.length
      ? progs.map(p => { const pc = progColor(p); return `<span class="prog-badge" style="background:${pc}20;color:${pc};margin-right:3px">${p}</span>`; }).join('')
      : '<span class="text-muted text-sm">—</span>';

    const progressBars = progs.length
      ? progs.map(p => {
          const dur   = progDuration(p) || 1;
          const week  = Math.min((c.programWeeks?.[p]) || (p === progs[0] ? c.currentWeek || 1 : 1), dur);
          const ps    = (c.programStatuses?.[p]) || '';
          const pct   = ps === 'Completed' ? 100 : Math.round((week / dur) * 100);
          const color = progColor(p);
          const psLabel = ps ? `<span style="font-size:10px;color:var(--text3);margin-left:2px">${ps}</span>` : '';
          return `<div class="week-progress" style="margin-bottom:3px">
            <span class="week-label" style="min-width:38px">Wk ${week}/${dur}</span>
            <div class="progress-bar-wrap" style="width:70px">
              <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            ${psLabel}
          </div>`;
        }).join('')
      : '<span class="text-muted text-sm">—</span>';

    const activityDot = hasNewActivity(c) ? '<span class="client-activity-dot" title="New activity"></span>' : '';
    return `<tr class="client-row" onclick="openModal('${cid}')">
      <td>
        <div class="name-cell">
          <div class="avatar" style="position:relative">${initials(c.name)}${activityDot}</div>
          <div><strong>${c.name}</strong><small>${c.businessName || c.email}</small></div>
        </div>
      </td>
      <td>${programBadges}</td>
      <td style="min-width:150px">${progressBars}</td>
      <td onclick="event.stopPropagation()">
        <select class="tbl-select tbl-status" onchange="quickPatch('${cid}','status',this.value,this)">
          ${statusOpts}
        </select>
      </td>
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
  list.forEach(c => {
    const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
    if (!progs.length) {
      grouped['Unassigned'] = grouped['Unassigned'] || [];
      grouped['Unassigned'].push({ c, prog: 'Unassigned' });
    } else {
      progs.forEach(prog => {
        grouped[prog] = grouped[prog] || [];
        grouped[prog].push({ c, prog });
      });
    }
  });

  const order = [...Object.keys(programsMap), 'Unassigned'];
  document.getElementById('prog-view-container').innerHTML = order.filter(k => grouped[k]?.length).map(k => {
    const grp   = grouped[k];
    const color = progColor(k);
    const cards = grp.map(({ c, prog }) => {
      const dur   = progDuration(prog);
      const wk    = Math.min((c.programWeeks?.[prog]) || c.currentWeek || 1, dur);
      const ps    = (c.programStatuses?.[prog]) || '';
      const pct   = ps === 'Completed' ? 100 : Math.round((wk / dur) * 100);
      const phase = getPhaseLabel(prog, wk);
      const lead  = (c.programLeads?.[prog]) || c.leadAssignee || '';
      return `<div class="prog-client-card" onclick="openModal('${c.id}')">
        <div class="prog-card-top">
          <div><div class="prog-card-name">${c.name}</div><div class="prog-card-biz">${c.businessName || c.email}</div></div>
          <span class="badge ${statusClass(c.status)}">${ps || c.status || '—'}</span>
        </div>
        ${phase ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${phase}</div>` : ''}
        <div style="background:var(--surface3);border-radius:4px;height:5px;margin-bottom:8px">
          <div style="width:${pct}%;height:100%;border-radius:4px;background:${color}"></div>
        </div>
        <div class="prog-card-meta">
          <span>Week ${wk} / ${dur}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${deadlineBadge(c)}
            ${lead ? `<span style="font-size:11px;color:var(--text2)">${lead}</span>` : ''}
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

  renderWeekTimeline('analytics-timeline', clients.filter(c => ACTIVE_STATUSES.includes(c.status)));
}

/* ── New Intakes ──────────────────────────────────────────────────────────── */
function renderIntakes() {
  const intakes = clients.filter(c => c.status === 'New');
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
function openClientById(id) {
  showTab('clients');
  setTimeout(() => openModal(id), 100);
}

function openAddClientModal() {
  // Populate program dropdown
  const progSel = document.getElementById('acm-program');
  progSel.innerHTML = '<option value="">— None —</option>' +
    Object.entries(programsMap).map(([id, p]) => `<option value="${escHtml(id)}">${escHtml(p.name||id)}</option>`).join('');

  // Populate coach dropdowns
  const teamOpts = ['<option value="">— Unassigned —</option>', ...team.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`)].join('');
  document.getElementById('acm-lead').innerHTML = teamOpts;
  document.getElementById('acm-tech').innerHTML = teamOpts;

  // Reset fields
  ['acm-name','acm-biz','acm-email','acm-phone'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('acm-status').value = 'New';
  document.getElementById('acm-error').style.display = 'none';

  document.getElementById('add-client-modal').classList.remove('hidden');
  document.getElementById('acm-name').focus();
}

function closeAddClientModal() {
  document.getElementById('add-client-modal').classList.add('hidden');
}

async function saveNewClient() {
  const name = document.getElementById('acm-name').value.trim();
  const errEl = document.getElementById('acm-error');
  if (!name) {
    errEl.textContent = 'Name is required.';
    errEl.style.display = 'block';
    document.getElementById('acm-name').focus();
    return;
  }
  errEl.style.display = 'none';

  const payload = {
    name,
    businessName:  document.getElementById('acm-biz').value.trim(),
    email:         document.getElementById('acm-email').value.trim(),
    phone:         document.getElementById('acm-phone').value.trim(),
    status:        document.getElementById('acm-status').value,
    program:       document.getElementById('acm-program').value || '',
    programs:      document.getElementById('acm-program').value ? [document.getElementById('acm-program').value] : [],
    leadAssignee:  document.getElementById('acm-lead').value,
    techAssignee:  document.getElementById('acm-tech').value,
  };

  const res = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { errEl.textContent = 'Failed to save. Please try again.'; errEl.style.display = 'block'; return; }
  const newClient = await res.json();
  clients.push(newClient);
  closeAddClientModal();
  renderClients();
  // Open the full profile so they can fill in more details
  openModal(newClient.id);
}

function openModal(id) {
  modalClient = clients.find(c => c.id === id);
  if (!modalClient) return;
  markClientViewed(id);
  modalChecklistData = {};
  // Init per-program week state
  const progs = modalClient.programs?.length ? modalClient.programs : (modalClient.program ? [modalClient.program] : []);
  modalProgramWeeks = { ...(modalClient.programWeeks || {}) };
  progs.forEach(p => { if (!modalProgramWeeks[p]) modalProgramWeeks[p] = 1; });
  // Default active program = first program
  modalActiveProgram = progs[0] || '';
  modalViewWeek = modalProgramWeeks[modalActiveProgram] || modalClient.currentWeek || 1;
  populateModal();
  document.getElementById('client-modal').classList.remove('hidden');
  renderChecklistTabs();
  if (modalActiveProgram) loadChecklist(modalViewWeek);
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

  const clientProgsForBadge = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
  const badge = document.getElementById('cm-prog-badge');
  if (clientProgsForBadge.length) {
    const firstProg = programsMap[clientProgsForBadge[0]];
    badge.textContent = clientProgsForBadge.length > 1
      ? clientProgsForBadge.map(p => programsMap[p]?.name || p).join(' · ')
      : (firstProg?.name || clientProgsForBadge[0]);
    badge.style.background = (firstProg?.color || '#8A7A6E') + '20';
    badge.style.color  = firstProg?.color || '#8A7A6E';
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
  document.getElementById('cm-status').value  = c.status      || '';
  document.getElementById('cm-lead').value    = c.leadAssignee || '';
  document.getElementById('cm-tech').value    = c.techAssignee || '';

  // --- Programs cards ---
  const progStatuses   = c.programStatuses  || {};
  const progStartDates = c.programStartDates || {};
  const progLeads      = c.programLeads     || {};
  const clientProgs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
  const allProgs = Object.keys(programsMap).filter(k => k !== 'Old Program');
  const PROG_STATUS_OPTS = ['Active','In Progress','On Hold','Completed','Cancelled'];
  const container = document.getElementById('cm-programs-container');
  const addArea   = document.getElementById('cm-programs-add');

  // Enrolled programs — shown as cards
  container.innerHTML = clientProgs.length ? clientProgs.map(name => {
    const prog   = programsMap[name];
    const color  = prog?.color || '#8A7A6E';
    const ps     = progStatuses[name]  || 'Active';
    const sd     = progStartDates[name] || '';
    const pl     = progLeads[name] || '';
    const dur    = prog?.duration || 0;
    const wk     = modalProgramWeeks[name] || 1;
    const endLabel = (sd && dur) ? (() => {
      const end = new Date(new Date(sd).getTime() + dur * 7 * 86400000);
      return end.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    })() : '—';
    const statusSel = PROG_STATUS_OPTS.map(s => `<option value="${s}" ${ps===s?'selected':''}>${s}</option>`).join('');
    const leadSel = `<option value="">— Lead —</option>${team.map(t => `<option value="${escHtml(t)}" ${pl===t?'selected':''}>${escHtml(t)}</option>`).join('')}`;
    const safeName = name.replace(/'/g,"\\'");
    return `<div class="prog-card" data-prog="${escHtml(name)}">
      <div class="prog-card-header">
        <span class="prog-card-dot" style="background:${color}"></span>
        <strong class="prog-card-name">${escHtml(name)}</strong>
        <select class="prog-status-sel inline-select" data-prog="${escHtml(name)}" style="font-size:11px;padding:2px 6px;margin-left:auto">${statusSel}</select>
        <button class="prog-card-remove" title="Remove program" onclick="removeProgramCard('${safeName}')">×</button>
      </div>
      <div class="prog-card-body">
        <div class="prog-card-dates">
          <div class="prog-date-field">
            <label class="prog-date-label">Start Date</label>
            <input type="date" class="prog-start-input inline-input" data-prog="${escHtml(name)}" value="${sd}" style="font-size:12px;padding:3px 6px" onchange="updateProgEndDate('${safeName}',this.value)">
          </div>
          <div class="prog-date-field">
            <label class="prog-date-label">End Date (${dur}wk)</label>
            <span class="prog-end-label" id="prog-end-${escHtml(name).replace(/\s+/g,'_')}">${endLabel}</span>
          </div>
        </div>
        <div class="prog-card-lead">
          <label class="prog-date-label">Lead Assignee</label>
          <select class="prog-lead-sel inline-select" data-prog="${escHtml(name)}" style="font-size:12px;padding:3px 6px;flex:1">${leadSel}</select>
        </div>
        <div class="prog-card-meta">
          Week ${wk} of ${dur || '?'}
          <button class="prog-restart-btn" onclick="restartProgram('${safeName}')">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            New cycle
          </button>
        </div>
      </div>
    </div>`;
  }).join('') : '<p style="font-size:12px;color:var(--text3);padding:4px 0">No programs enrolled yet.</p>';

  // Wire status selects — auto-complete checklist when set to Completed
  container.querySelectorAll('.prog-status-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (sel.value !== 'Completed') return;
      const progName = sel.dataset.prog;
      if (!confirm(`Mark all checklist tasks for "${progName}" as complete?`)) return;
      sel.disabled = true;
      try {
        const res = await fetch(`/api/clients/${modalClient.id}/complete-program/${encodeURIComponent(progName)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          // Update local checklist cache so view reflects immediately
          Object.entries(data.checklists || {}).forEach(([wk, fields]) => {
            const key = `${progName}__${wk}`;
            modalChecklistData[key] = { fields, recordId: modalClient.id, programId: progName };
          });
          if (modalActiveProgram === progName) renderChecklist(modalViewWeek);
        }
      } catch (e) { console.error('auto-complete failed', e); }
      sel.disabled = false;
    });
  });

  // "Add program" dropdown for unenrolled programs
  const unenrolled = allProgs.filter(p => !clientProgs.includes(p));
  addArea.innerHTML = unenrolled.length ? `
    <select id="cm-add-prog-sel" class="inline-select" style="font-size:12px">
      <option value="">+ Enroll in a program…</option>
      ${unenrolled.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('')}
    </select>` : '';
  const addSel = addArea.querySelector('#cm-add-prog-sel');
  if (addSel) {
    addSel.addEventListener('change', () => {
      const name = addSel.value;
      if (!name) return;
      if (!modalProgramWeeks[name]) modalProgramWeeks[name] = 1;
      if (name && !modalActiveProgram) modalActiveProgram = name;
      // Temporarily update modalClient.programs so re-render works
      const progs = modalClient.programs?.length ? [...modalClient.programs] : (modalClient.program ? [modalClient.program] : []);
      if (!progs.includes(name)) progs.push(name);
      modalClient.programs = progs;
      if (!modalActiveProgram) modalActiveProgram = progs[0] || '';
      // Re-render programs section
      populateModal();
      renderChecklistTabs();
      addSel.value = '';
    });
  }

  // Hourly / Out-of-scope notes
  document.getElementById('addon-custom').value = c.addOns || '';

  // Content fields
  document.getElementById('cm-brand').value    = c.brandDirection || '';
  document.getElementById('cm-services').value = c.servicesAndPricing || '';
  document.getElementById('cm-goals').value    = [c.targetAudience ? 'Audience: ' + c.targetAudience : '', c.goals || ''].filter(Boolean).join('\n');
  document.getElementById('cm-filming').value  = c.filmingAvailability || '';

  // Notes log
  renderNotesLog(c.notesLog || []);

  // Unified feed (server auto-tracked + local manual entries)
  renderUnifiedFeed(c, localStore[c.id] || {});

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
  // Legacy shim — routes to unified feed if available
  const el = document.getElementById('cm-activity-feed');
  if (!el) return;
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

function renderUnifiedFeed(c, localData) {
  const el = document.getElementById('cm-unified-feed');
  if (!el) return;
  const ACTION_ICON = {
    'Client created': '🟢', 'Client updated': '✏️', 'Task checked': '✅',
    'Task unchecked': '⬜', 'Task note saved': '📝', 'Add-on task checked': '✅',
    'Add-on task unchecked': '⬜', 'Add-on task note saved': '📝', 'Note added': '💬',
  };
  // Server auto-tracked entries
  const serverLog = (c.activityLog || [])
    .filter(e => e.action && !e.action.includes('undefined') && e.details !== 'undefined')
    .map(e => ({ ...e, _source: 'server' }));
  // Local manual entries
  const localLog = ((localData || {}).activityLog || [])
    .map(e => ({ ...e, _source: 'local' }));
  // Merge and sort descending by ts
  const merged = [...serverLog, ...localLog].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  if (!merged.length) { el.innerHTML = '<div class="note-empty">No entries yet.</div>'; return; }
  el.innerHTML = merged.map(e => {
    if (e._source === 'server') {
      return `<div class="actlog-row">
        <div class="actlog-icon">${ACTION_ICON[e.action] || '📋'}</div>
        <div class="actlog-body">
          <div class="actlog-top">
            <span class="actlog-action">${escHtml(e.action)}</span>
            <span class="actlog-time">${fmtTs(e.ts)}</span>
          </div>
          <div class="actlog-who">by <strong>${escHtml(e.userName || 'System')}</strong></div>
          ${e.details ? `<div class="actlog-details">${escHtml(e.details)}</div>` : ''}
        </div>
      </div>`;
    } else {
      return `<div class="actlog-row">
        <div class="actlog-icon">${ACTIVITY_ICONS[e.type] || '📝'}</div>
        <div class="actlog-body">
          <div class="actlog-top">
            <span class="actlog-action">${escHtml(e.type || 'note')}</span>
            <span class="actlog-time">${fmtTs(e.ts)}</span>
          </div>
          <div class="actlog-who">by <strong>${escHtml(e.author || 'Team')}</strong></div>
          ${e.text ? `<div class="actlog-details">${escHtml(e.text)}</div>` : ''}
          ${e.changes ? e.changes.map(ch => `<div class="activity-change"><span>${ch.field}</span><span class="ch-from">${ch.from}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span class="ch-to">${ch.to}</span></div>`).join('') : ''}
        </div>
      </div>`;
    }
  }).join('');
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
    await appendActivityEntry(modalClient.id, { type, text, author, ts: new Date().toISOString() });
    renderUnifiedFeed(modalClient, localStore[modalClient.id] || {});
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
    business: 'Business', status: 'Status', programs: 'Programs',
    leadAssignee: 'Lead Coach', techAssignee: 'Tech',
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

/* ── Program tabs + switchProgram ─────────────────────────────────────────── */
function renderChecklistTabs() {
  const container = document.getElementById('cl-prog-tabs');
  if (!container) return;
  const c = modalClient;
  if (!c) { container.innerHTML = ''; return; }
  const progs = c.programs?.length ? c.programs : (c.program ? [c.program] : []);
  if (progs.length <= 1) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = progs.map(name => {
    const prog = programsMap[name];
    const active = name === modalActiveProgram;
    const color = prog?.color || '#8A7A6E';
    return `<button class="prog-tab ${active ? 'active' : ''}"
      style="${active ? `border-color:${color};color:${color}` : ''}"
      onclick="switchProgram('${escHtml(name).replace(/'/g,"\\'")}')">
      <span class="prog-tab-dot" style="background:${color}"></span>
      ${escHtml(prog?.name || name)}
    </button>`;
  }).join('');
}

function switchProgram(name) {
  if (name === modalActiveProgram) return;
  modalActiveProgram = name;
  modalViewWeek = modalProgramWeeks[name] || 1;
  modalChecklistData = {};
  renderChecklistTabs();
  loadChecklist(modalViewWeek);
}

function onProgramToggle(cb) {
  const checked = [...document.querySelectorAll('.prog-checkbox:checked')].map(c => c.value);
  checked.forEach(p => { if (!modalProgramWeeks[p]) modalProgramWeeks[p] = 1; });
  if (!checked.includes(modalActiveProgram)) {
    modalActiveProgram = checked[0] || '';
    modalViewWeek = modalProgramWeeks[modalActiveProgram] || 1;
  }
}

function restartProgram(progName) {
  if (!modalClient) return;
  if (!confirm(`Start a new cycle for "${progName}"? This will reset its week back to 1.`)) return;
  modalProgramWeeks[progName] = 1;
  // Update the status select to "Active"
  const sel = document.querySelector(`.prog-status-sel[data-prog="${CSS.escape(progName)}"]`);
  if (sel) sel.value = 'Active';
  // If it's the currently active program, reload checklist at week 1
  if (modalActiveProgram === progName) {
    modalViewWeek = 1;
    modalChecklistData = {};
    loadChecklist(1);
  }
}

function removeProgramCard(name) {
  if (!modalClient) return;
  if (!confirm(`Remove "${name}" from this client's programs?`)) return;
  modalClient.programs = (modalClient.programs || []).filter(p => p !== name);
  if (modalActiveProgram === name) {
    modalActiveProgram = modalClient.programs[0] || '';
    modalViewWeek = modalProgramWeeks[modalActiveProgram] || 1;
  }
  populateModal();
  renderChecklistTabs();
}

function updateProgEndDate(name, startVal) {
  const prog = programsMap[name];
  const dur  = prog?.duration || 0;
  const key  = name.replace(/\s+/g, '_');
  const el   = document.getElementById(`prog-end-${key}`);
  if (!el) return;
  if (startVal && dur) {
    const end = new Date(new Date(startVal).getTime() + dur * 7 * 86400000);
    el.textContent = end.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  } else {
    el.textContent = '—';
  }
}

/* ── Checklist (dynamic from programsMap) ─────────────────────────────────── */
async function loadChecklist(week) {
  const c = modalClient;
  if (!c) return;

  const wk = week || 1;
  modalViewWeek = wk;
  modalProgramWeeks[modalActiveProgram] = wk;

  if (modalActiveProgram === 'Old Program') { renderOldProgramChecklist(wk); return; }

  setChecklistLoading(true);
  const cacheKey = `${modalActiveProgram}__${wk}`;
  try {
    const url = `/api/clients/${c.id}/checklist/${wk}?program=${encodeURIComponent(modalActiveProgram)}`;
    const res  = await fetch(url);
    const data = await res.json();
    modalChecklistData[cacheKey] = data;
  } catch {
    modalChecklistData[cacheKey] = { fields: {}, recordId: null };
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
  const prog = programsMap[modalActiveProgram] || programsMap[modalClient?.program];
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
  const cacheKey = `${modalActiveProgram}__${wk}`;
  const fields = (modalChecklistData[cacheKey] || {}).fields || {};
  const progNotes = modalClient?.checklistNotes?.[modalActiveProgram] || {};
  const notes  = progNotes[wk] || {};
  const progAssignees = (modalClient?.checklistAssignees?.[modalActiveProgram] || {})[wk] || {};

  document.getElementById('cl-gathr').innerHTML = def.items.map(({ id, label }) => {
    const done    = !!fields[id];
    const noteObj = notes[id] || {};
    const noteText = noteObj.note || '';
    const noteStatus = noteObj.status || 'pending';
    const itemAssignee = progAssignees[id] || '';
    const safeId   = id.replace(/'/g,"\\'");
    const statusColors = { pending: '#7A6E62', 'in-progress': '#F0813A', done: '#5AA872', blocked: '#ef4444' };
    const statusLabels = { pending: 'Pending', 'in-progress': 'In Progress', done: 'Done', blocked: 'Blocked' };
    const assigneeSel = `<option value="">Assignee</option>${team.map(t => `<option value="${escHtml(t)}" ${itemAssignee===t?'selected':''}>${escHtml(t)}</option>`).join('')}`;
    return `<div class="checklist-item-wrap">
      <div class="checklist-item" onclick="toggleCheck(${wk},'${safeId}',${!done},'${label.replace(/'/g,"\\'")}')">
        <div class="check-box ${done ? 'checked' : ''}">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
        </div>
        <span class="check-label ${done ? 'done' : ''}">${label}</span>
        <button class="cl-note-btn" onclick="event.stopPropagation();toggleChecklistNote('${safeId}',${wk})" title="Add note">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          ${noteText ? '<span class="cl-note-dot"></span>' : ''}
        </button>
      </div>
      <div class="cl-note-area hidden" id="cl-note-${wk}-${id}">
        <div class="cl-note-status-row">
          ${['pending','in-progress','done','blocked'].map(s => `
            <button class="cl-status-btn ${noteStatus===s?'active':''}" style="${noteStatus===s?`background:${statusColors[s]}20;color:${statusColors[s]};border-color:${statusColors[s]}`:''}"
              onclick="setChecklistStatus('${safeId}',${wk},'${s}')">${statusLabels[s]}</button>`).join('')}
        </div>
        <div class="cl-note-assignee-row">
          <label style="font-size:11px;color:var(--text3);white-space:nowrap">Assignee:</label>
          <select class="inline-select cl-assignee-sel" style="font-size:11px;padding:2px 6px;flex:1"
            onchange="saveChecklistAssignee('${safeId}',${wk},this.value)" onclick="event.stopPropagation()">${assigneeSel}</select>
        </div>
        <textarea class="cl-note-textarea" id="cl-note-text-${wk}-${id}" placeholder="Add details, blockers, context…" rows="2">${escHtml(noteText)}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
          <button class="btn-view" style="font-size:11px;padding:4px 10px" onclick="saveChecklistNote('${safeId}',${wk})">Save Note</button>
          <span class="cl-note-msg" id="cl-note-msg-${wk}-${id}" style="font-size:11px;color:var(--green)"></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleChecklistNote(itemId, wk) {
  const area = document.getElementById(`cl-note-${wk}-${itemId}`);
  if (area) area.classList.toggle('hidden');
}

async function setChecklistStatus(itemId, wk, status) {
  const noteEl = document.getElementById(`cl-note-text-${wk}-${itemId}`);
  const note   = noteEl?.value || '';
  await saveChecklistNoteData(itemId, wk, note, status);
}

async function saveChecklistNote(itemId, wk) {
  const noteEl = document.getElementById(`cl-note-text-${wk}-${itemId}`);
  const note   = noteEl?.value || '';
  const progNotes = modalClient?.checklistNotes?.[modalActiveProgram] || {};
  const existing = (progNotes[wk]?.[itemId]) || {};
  await saveChecklistNoteData(itemId, wk, note, existing.status || 'pending');
}

async function saveChecklistNoteData(itemId, wk, note, status) {
  const msgEl = document.getElementById(`cl-note-msg-${wk}-${itemId}`);
  if (msgEl) msgEl.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/checklist-notes/${modalClient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week: wk, itemId, note, status, programId: modalActiveProgram }),
    });
    if (res.ok) {
      const data = await res.json();
      modalClient.checklistNotes = data.checklistNotes;
      const idx = clients.findIndex(x => x.id === modalClient.id);
      if (idx !== -1) clients[idx].checklistNotes = data.checklistNotes;
      if (msgEl) { msgEl.textContent = '✓ Saved'; setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 2000); }
      renderChecklist(wk);
    }
  } catch (e) {
    if (msgEl) msgEl.textContent = 'Error';
    console.error(e);
  }
}

async function saveChecklistAssignee(itemId, wk, assignee) {
  if (!modalClient) return;
  try {
    const res = await fetch(`/api/checklist-assign/${modalClient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week: wk, itemId, assignee, programId: modalActiveProgram }),
    });
    if (res.ok) {
      const data = await res.json();
      modalClient.checklistAssignees = data.checklistAssignees;
      const idx = clients.findIndex(x => x.id === modalClient.id);
      if (idx !== -1) clients[idx].checklistAssignees = data.checklistAssignees;
    }
  } catch (e) { console.error('assign failed', e); }
}

async function toggleCheck(week, field, newValue, label) {
  const cacheKey = `${modalActiveProgram}__${week}`;
  const data = modalChecklistData[cacheKey] || {};
  data.fields = data.fields || {};
  data.recordId = data.recordId || modalClient?.id;
  modalChecklistData[cacheKey] = data;

  data.fields[field] = newValue;
  renderChecklist(week);

  try {
    const res = await fetch(`/api/checklist/${week}/${modalClient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value: newValue, label: label || field, programId: modalActiveProgram }),
    });
    const updated = await res.json();
    if (updated.fields) { modalChecklistData[cacheKey].fields = updated.fields; renderChecklist(week); }
  } catch (e) {
    data.fields[field] = !newValue;
    renderChecklist(week);
    console.error('toggleCheck failed', e);
  }
}

document.getElementById('cl-prev').addEventListener('click', () => {
  modalViewWeek--;
  if (modalActiveProgram) modalProgramWeeks[modalActiveProgram] = modalViewWeek;
  loadChecklist(modalViewWeek);
});
document.getElementById('cl-next').addEventListener('click', () => {
  modalViewWeek++;
  if (modalActiveProgram) modalProgramWeeks[modalActiveProgram] = modalViewWeek;
  loadChecklist(modalViewWeek);
});

/* ── Save client ──────────────────────────────────────────────────────────── */
document.getElementById('btn-save-client').addEventListener('click', async () => {
  const c = modalClient;

  const customAddon = document.getElementById('addon-custom').value.trim();

  const newName = document.getElementById('cm-name-input').value.trim() || c.name;
  const patch = {
    name:               newName,
    businessName:       document.getElementById('cm-bizname-input').value.trim(),
    email:              document.getElementById('cm-email').value.trim(),
    phone:              document.getElementById('cm-phone').value.trim(),
    instagram:          document.getElementById('cm-insta').value.trim(),
    website:            document.getElementById('cm-website').value.trim(),
    business:           document.getElementById('cm-business').value,
    programs:           [...document.querySelectorAll('.prog-card')].map(el => el.dataset.prog),
    programWeeks:       { ...modalProgramWeeks },
    programStatuses:    Object.fromEntries([...document.querySelectorAll('.prog-status-sel')].map(s => [s.dataset.prog, s.value])),
    programLeads:       Object.fromEntries([...document.querySelectorAll('.prog-lead-sel')].map(s => [s.dataset.prog, s.value])),
    programStartDates: Object.fromEntries(
      [...document.querySelectorAll('.prog-start-input')].map(i => [i.dataset.prog, i.value])
    ),
    status:             document.getElementById('cm-status').value,
    leadAssignee:       document.getElementById('cm-lead').value,
    techAssignee:       document.getElementById('cm-tech').value,
    brandDirection:     document.getElementById('cm-brand').value,
    servicesAndPricing: document.getElementById('cm-services').value,
    goals:              document.getElementById('cm-goals').value,
    filmingAvailability:document.getElementById('cm-filming').value,
    addOns:             customAddon,
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
        renderUnifiedFeed(modalClient, stored);
      }).catch(console.error);
    }

    Object.assign(c, updated);
    const idx = clients.findIndex(x => x.id === c.id);
    if (idx !== -1) clients[idx] = updated;

    document.getElementById('cm-name').textContent = updated.name || '';

    const sBadge = document.getElementById('cm-status-badge');
    sBadge.textContent = updated.status || '—';
    sBadge.className = `badge ${statusClass(updated.status)}`;

    const updatedProgs = updated.programs?.length ? updated.programs : (updated.program ? [updated.program] : []);
    const badge = document.getElementById('cm-prog-badge');
    if (updatedProgs.length) {
      const fp = programsMap[updatedProgs[0]];
      badge.textContent = updatedProgs.length > 1
        ? updatedProgs.map(p => programsMap[p]?.name || p).join(' · ')
        : (fp?.name || updatedProgs[0]);
      badge.style.background = (fp?.color || '#8A7A6E') + '20';
      badge.style.color = fp?.color || '#8A7A6E';
      badge.style.display = 'inline-block';
    }

    // Refresh checklist tabs + content immediately after save
    modalProgramWeeks = { ...(updated.programWeeks || {}) };
    if (!updatedProgs.includes(modalActiveProgram)) {
      modalActiveProgram = updatedProgs[0] || '';
      modalViewWeek = modalProgramWeeks[modalActiveProgram] || 1;
    }
    renderChecklistTabs();
    if (modalActiveProgram) loadChecklist(modalViewWeek);

    // Refresh background client list (table / overview)
    renderClients();
    if (activeTab === 'overview') renderOverview();

    msgEl.style.color = 'var(--green)';
    msgEl.textContent = '✓ Saved';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } else {
    msgEl.style.color = '#e53e3e';
    msgEl.textContent = 'Error saving — check console';
  }
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
async function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  const empty = document.getElementById('users-empty');
  if (!tbody) return;
  try {
    const res   = await fetch('/api/users');
    if (!res.ok) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
    const users = await res.json();
    if (!users.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
    empty?.classList.add('hidden');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><div class="name-cell">
          <div class="avatar" style="background:var(--accent-dim);color:var(--accent)">${initials(u.name)}</div>
          <strong>${escHtml(u.name)}</strong>
        </div></td>
        <td class="text-sm text-muted">${escHtml(u.email)}</td>
        <td>
          <select class="tbl-select" onchange="setUserRole('${u.id}',this.value)" style="max-width:110px" title="App role">
            <option value="member" ${u.role==='member'?'selected':''}>Member</option>
            <option value="admin"  ${u.role==='admin'?'selected':''}>Admin</option>
          </select>
        </td>
        <td>
          <select class="tbl-select" onchange="setUserTeamRole('${u.id}',this.value)" style="max-width:130px" title="Dropdown role (Lead/Tech)">
            <option value="lead"  ${(u.teamRole||'lead')==='lead'?'selected':''}>Lead Coach</option>
            <option value="tech"  ${u.teamRole==='tech'?'selected':''}>Tech</option>
            <option value="admin" ${u.teamRole==='admin'?'selected':''}>Admin</option>
          </select>
        </td>
        <td class="text-sm text-muted">${fmtDate(u.createdAt)}</td>
        <td style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn-view" style="padding:4px 10px;font-size:11px" onclick="openUserActivityPanel('${u.id}','${escHtml(u.name)}')">Activity</button>
          <button class="btn-view" style="padding:4px 10px;font-size:11px" onclick="showResetPassword('${u.id}','${escHtml(u.name)}')">Reset PW</button>
          <button class="btn-danger" style="padding:4px 10px;font-size:11px" onclick="removeUser('${u.id}','${escHtml(u.name)}')">Remove</button>
        </td>
      </tr>`).join('');
  } catch { tbody.innerHTML = ''; }
}

function openUserActivityPanel(userId, userName) {
  document.getElementById('user-actlog-name').textContent = userName + '\'s Activity';
  document.getElementById('user-actlog-modal').classList.remove('hidden');
  renderUserActivityLog(userId, 'user-actlog-list');
}

async function setUserTeamRole(id, teamRole) {
  await fetch(`/api/users/${id}/teamrole`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ teamRole }) });
  const tRes = await fetch('/api/team');
  const teamData = await tRes.json();
  team = teamData.map(m => m.name);
  window._teamFull = teamData;
  populateAssigneeFilters();
}

function showResetPassword(id, name) {
  document.getElementById('reset-pw-user-id').value   = id;
  document.getElementById('reset-pw-user-name').textContent = name;
  document.getElementById('reset-pw-input').value     = '';
  document.getElementById('reset-pw-msg').textContent = '';
  document.getElementById('reset-pw-modal').classList.remove('hidden');
}

async function doResetPassword() {
  const id  = document.getElementById('reset-pw-user-id').value;
  const pw  = document.getElementById('reset-pw-input').value.trim();
  const msg = document.getElementById('reset-pw-msg');
  if (!pw) { msg.style.color = 'var(--accent2)'; msg.textContent = 'Enter a password.'; return; }
  const res = await fetch(`/api/users/${id}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (res.ok) {
    msg.style.color = 'var(--green)'; msg.textContent = 'Password updated.';
    setTimeout(() => document.getElementById('reset-pw-modal').classList.add('hidden'), 1200);
  } else {
    msg.style.color = 'var(--accent2)'; msg.textContent = 'Failed. Try again.';
  }
}

async function setUserRole(id, role) {
  await fetch(`/api/users/${id}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
}

async function removeUser(id, name) {
  if (!confirm(`Remove ${name}?`)) return;
  await fetch(`/api/users/${id}`, { method: 'DELETE' });
  renderUsers();
}

function renderTeam() {
  const allMembers = window._teamFull || [];
  // Manual roster = entries without isRegistered flag
  const members = allMembers.filter(m => !m.isRegistered);
  const total = allMembers.length;
  document.getElementById('team-subtitle').textContent = `${total} member${total !== 1 ? 's' : ''}`;
  const tbody = document.getElementById('team-tbody');
  const empty = document.getElementById('team-empty');
  renderUsers();

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

  const statusColors = { pending: '#7A6E62', 'in-progress': '#F0813A', done: '#5AA872', blocked: '#ef4444' };
  const statusLabels = { pending: 'Pending', 'in-progress': 'In Progress', done: 'Done', blocked: 'Blocked' };

  section.innerHTML = activeAddons.map(addonName => {
    const addon = Object.values(addonsMap).find(a => a.name === addonName);
    if (!addon || !addon.deliverables?.length) return '';
    const checks = (c.addonChecklists?.[addonName]) || {};
    const notes  = (c.addonChecklistNotes?.[addonName]) || {};
    const done  = addon.deliverables.filter(d => checks[d.id]).length;
    const total = addon.deliverables.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;
    const safeAddon = addonName.replace(/'/g,"\\'");
    const items = addon.deliverables.map(d => {
      const isChecked  = !!checks[d.id];
      const noteObj    = notes[d.id] || {};
      const noteText   = noteObj.note || '';
      const noteStatus = noteObj.status || 'pending';
      const safeId     = d.id.replace(/'/g,"\\'");
      return `<div class="checklist-item-wrap">
        <div class="checklist-item" onclick="toggleAddonCheck('${safeAddon}','${safeId}',${!isChecked},'${d.label.replace(/'/g,"\\'")}')">
          <div class="check-box ${isChecked ? 'checked' : ''}">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
          </div>
          <span class="check-label ${isChecked ? 'done' : ''}">${escHtml(d.label)}</span>
          <button class="cl-note-btn" onclick="event.stopPropagation();toggleAddonNote('${safeAddon}','${safeId}')" title="Add note">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ${noteText ? '<span class="cl-note-dot"></span>' : ''}
          </button>
        </div>
        <div class="cl-note-area hidden" id="addon-note-${addonName}-${d.id}">
          <div class="cl-note-status-row">
            ${['pending','in-progress','done','blocked'].map(s => `
              <button class="cl-status-btn ${noteStatus===s?'active':''}" style="${noteStatus===s?`background:${statusColors[s]}20;color:${statusColors[s]};border-color:${statusColors[s]}`:''}"
                onclick="setAddonNoteStatus('${safeAddon}','${safeId}','${s}')">${statusLabels[s]}</button>`).join('')}
          </div>
          <textarea class="cl-note-textarea" id="addon-note-text-${addonName}-${d.id}" placeholder="Add details, blockers, context…" rows="2">${escHtml(noteText)}</textarea>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
            <button class="btn-view" style="font-size:11px;padding:4px 10px" onclick="saveAddonNote('${safeAddon}','${safeId}')">Save Note</button>
            <span class="cl-note-msg" id="addon-note-msg-${addonName}-${d.id}" style="font-size:11px;color:var(--green)"></span>
          </div>
        </div>
      </div>`;
    }).join('');
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

function toggleAddonNote(addonName, itemId) {
  const area = document.getElementById(`addon-note-${addonName}-${itemId}`);
  if (area) area.classList.toggle('hidden');
}

async function setAddonNoteStatus(addonName, itemId, status) {
  const noteEl = document.getElementById(`addon-note-text-${addonName}-${itemId}`);
  await saveAddonNoteData(addonName, itemId, noteEl?.value || '', status);
}

async function saveAddonNote(addonName, itemId) {
  const noteEl = document.getElementById(`addon-note-text-${addonName}-${itemId}`);
  const existing = (modalClient?.addonChecklistNotes?.[addonName]?.[itemId]) || {};
  await saveAddonNoteData(addonName, itemId, noteEl?.value || '', existing.status || 'pending');
}

async function saveAddonNoteData(addonName, itemId, note, status) {
  const msgEl = document.getElementById(`addon-note-msg-${addonName}-${itemId}`);
  if (msgEl) msgEl.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/addon-checklist-notes/${modalClient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addonName, itemId, note, status }),
    });
    if (res.ok) {
      const data = await res.json();
      modalClient.addonChecklistNotes = data.addonChecklistNotes;
      const idx = clients.findIndex(x => x.id === modalClient.id);
      if (idx !== -1) clients[idx].addonChecklistNotes = data.addonChecklistNotes;
      if (msgEl) { msgEl.textContent = '✓ Saved'; setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 2000); }
      renderAddonChecklists(modalClient);
    }
  } catch (e) {
    if (msgEl) msgEl.textContent = 'Error';
    console.error(e);
  }
}

async function toggleAddonCheck(addonName, itemId, value, label) {
  if (!modalClient) return;
  const res = await fetch(`/api/addon-checklist/${modalClient.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addonName, itemId, value, label: label || itemId }),
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
