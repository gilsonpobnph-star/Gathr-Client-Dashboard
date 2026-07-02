/* ── Program data ─────────────────────────────────────────────────────────── */
const PROGRAMS = {
  'Full Brand OS': {
    label: 'Full Brand OS', duration: 16, price: '$4,500', color: '#8b5cf6',
    phases: [
      { name: 'Phase 1 · Build the Foundation', weeks: [1,2,3,4] },
      { name: 'Phase 2 · Activate Outreach', weeks: [5,6,7,8] },
      { name: 'Phase 3 · Scale + Campaigns', weeks: [9,10,11,12] },
      { name: 'Phase 4 · The Event', weeks: [13,14,15,16] },
    ],
  },
  'Phase 1 Setup': { label: 'Phase 1 — Setup', duration: 4, price: '$1,500', color: '#3b82f6', phases: [{ name: 'Weeks 1–4 · Build the Foundation', weeks: [1,2,3,4] }] },
  'Content':       { label: 'Content', duration: 1, price: '$1,000–$1,500/mo', color: '#f59e0b', phases: [{ name: 'Monthly', weeks: [1] }] },
  'Ads Management':{ label: 'Ads Management', duration: 1, price: '$1,000–$1,500/mo', color: '#ef4444', phases: [{ name: 'Monthly', weeks: [1] }] },
  'Website':       { label: 'Website', duration: 1, price: '$3,500', color: '#14b8a6', phases: [{ name: 'Build', weeks: [1] }] },
  'Custom':        { label: 'Custom / Hourly', duration: 1, price: 'Custom quote', color: '#6b7280', phases: [{ name: 'Custom', weeks: [1] }] },
};

// Checklist field definitions per week — labels for display, keys match Airtable exactly
const CHECKLIST_DEFS = {
  1: [
    { field: 'IF',   label: 'Intake form submitted' },
    { field: 'BDC',  label: 'Branding direction call done' },
    { field: 'CFS',  label: 'Content filming session completed' },
    { field: 'WIGM', label: 'WIG meeting attended' },
    { field: 'BPCL', label: 'Bio/profile content launched' },
  ],
  2: [
    { field: 'CRM&F', label: 'CRM & funnel built' },
    { field: 'Auto',  label: 'Automations set up' },
    { field: 'Cal',   label: 'Booking calendar live' },
    { field: 'Dom',   label: 'Domain connected' },
    { field: 'BPN#',  label: 'Business phone number set up' },
    { field: 'Offer', label: 'Offer configured' },
    { field: 'FOS',   label: 'Funnel / offer setup complete' },
  ],
  3: [
    { field: 'RSB', label: 'Review & sign-off on build' },
    { field: 'ACF', label: 'Attended revision call, gave feedback' },
    { field: 'FCL', label: 'Final confirmation & launch approved' },
  ],
  4: [
    { field: '1:1 CRMT',  label: '1:1 CRM training delivered' },
    { field: 'SOP&P',     label: 'SOPs & playbook sent' },
    { field: 'SMM (W4-8)',label: 'Social media management started (W4–8)' },
    { field: 'Launch',    label: 'System fully launched' },
  ],
};

const WEEK_TITLES = {
  1: 'Week 1 — Intake & Filming',
  2: 'Week 2 — Software Build',
  3: 'Week 3 — Review & Revisions',
  4: 'Week 4 — Onboarding & Launch',
};

/* ── State ────────────────────────────────────────────────────────────────── */
let clients = [];
let team = [];
let activeTab = 'overview';
let modalClient = null;
let modalViewWeek = 1;
let modalChecklistData = {};   // { week: { fields: {field: bool}, recordId: string } }
let charts = {};

/* ── Utils ────────────────────────────────────────────────────────────────── */
function initials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function statusClass(s) {
  const m = {
    'Active': 'badge-active',
    'Paused': 'badge-paused',
    'Completed': 'badge-completed',
    'Intake Received': 'badge-intake',
    'Onboarding': 'badge-onboarding',
  };
  return m[s] || 'badge-intake';
}

function progColor(p) { return (PROGRAMS[p] || {}).color || '#6b7280'; }
function progDuration(p) { return (PROGRAMS[p] || {}).duration || 1; }

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getPhaseLabel(program, week) {
  const prog = PROGRAMS[program];
  if (!prog) return '';
  for (const phase of prog.phases) {
    if (phase.weeks.includes(week)) return phase.name;
  }
  return '';
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
  const pw = document.getElementById('login-pw').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) showApp();
  else err.textContent = 'Incorrect password. Try again.';
}

/* ── Data Loading ─────────────────────────────────────────────────────────── */
async function loadAll() {
  document.getElementById('loading').classList.remove('hidden');
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));

  const [cRes, tRes] = await Promise.all([fetch('/api/clients'), fetch('/api/team')]);
  clients = await cRes.json();
  team = await tRes.json();

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

  if (tab === 'overview') renderOverview();
  else if (tab === 'clients') renderClients();
  else if (tab === 'programs') renderPrograms();
  else if (tab === 'analytics') renderAnalytics();
  else if (tab === 'intake') renderIntakes();
}

/* ── Assignee filters ─────────────────────────────────────────────────────── */
function populateAssigneeFilters() {
  const sel = document.getElementById('filter-assignee');
  sel.innerHTML = '<option value="">All Assignees</option>';
  team.forEach(t => {
    const o = document.createElement('option'); o.value = t; o.textContent = t;
    sel.appendChild(o);
  });

  ['cm-lead', 'cm-tech'].forEach(id => {
    const s = document.getElementById(id);
    s.innerHTML = '<option value="">— Unassigned —</option>';
    team.forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      s.appendChild(o);
    });
  });
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
function renderOverview() {
  const active    = clients.filter(c => c.status === 'Active').length;
  const intake    = clients.filter(c => c.status === 'Intake Received').length;
  const paused    = clients.filter(c => c.status === 'Paused').length;
  const completed = clients.filter(c => c.status === 'Completed').length;

  document.getElementById('kpi-active').textContent    = active;
  document.getElementById('kpi-intake').textContent    = intake;
  document.getElementById('kpi-paused').textContent    = paused;
  document.getElementById('kpi-completed').textContent = completed;
  document.getElementById('kpi-active-sub').textContent = `${clients.length} total clients`;
  document.getElementById('overview-subtitle').textContent =
    `Last refreshed ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;

  renderWeekTimeline('week-timeline-container', clients.filter(c => c.status === 'Active'));
  renderChart('chart-programs', 'doughnut', programChartData());
  renderChart('chart-status',   'doughnut', statusChartData());
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
    return `<div class="wt-row" style="margin-bottom:6px">
      <div class="wt-name" title="${c.name}">${c.name}</div>
      <div class="wt-track" style="flex:1;height:26px;background:var(--surface2);border-radius:6px;overflow:hidden;cursor:pointer" onclick="openModal('${c.id}')">
        <div style="width:${pct}%;height:100%;background:${color};opacity:.85;border-radius:6px;display:flex;align-items:center;padding-left:8px">
          ${pct > 15 ? `<span style="font-size:11px;font-weight:700;color:rgba(0,0,0,.75)">${phase || c.program || 'Active'}</span>` : ''}
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
      plugins: { legend: { labels: { color: '#8b91a7', font: { size: 11 }, padding: 12 } } },
      scales: type === 'bar' ? {
        x: { ticks: { color: '#8b91a7', font: { size: 11 } }, grid: { color: '#2a2f3d' } },
        y: { ticks: { color: '#8b91a7', font: { size: 11 } }, grid: { color: '#2a2f3d' } },
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
  const colors = { Active: '#22c55e', Paused: '#f59e0b', Completed: '#3b82f6', 'Intake Received': '#8b5cf6', Onboarding: '#14b8a6', Unknown: '#6b7280' };
  const labels = Object.keys(counts);
  return { labels, datasets: [{ data: Object.values(counts), backgroundColor: labels.map(l => colors[l] || '#6b7280'), borderWidth: 0 }] };
}

/* ── Clients table ────────────────────────────────────────────────────────── */
function renderClients() {
  const search   = (document.getElementById('client-search').value || '').toLowerCase();
  const statusF  = document.getElementById('filter-status').value;
  const progF    = document.getElementById('filter-program').value;
  const assigneeF= document.getElementById('filter-assignee').value;

  const list = clients.filter(c => {
    if (statusF   && c.status !== statusF) return false;
    if (progF     && c.program !== progF) return false;
    if (assigneeF && c.leadAssignee !== assigneeF && c.techAssignee !== assigneeF) return false;
    if (search) {
      if (!`${c.name} ${c.businessName} ${c.email}`.toLowerCase().includes(search)) return false;
    }
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
    return `<tr>
      <td>
        <div class="name-cell">
          <div class="avatar">${initials(c.name)}</div>
          <div><strong>${c.name}</strong><small>${c.businessName || c.email}</small></div>
        </div>
      </td>
      <td>${c.program ? `<span class="prog-badge" style="background:${color}22;color:${color}">${c.program}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td style="min-width:140px">
        <div class="week-progress">
          <span class="week-label">Wk ${week}/${dur}</span>
          <div class="progress-bar-wrap" style="width:80px">
            <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </td>
      <td>${c.status ? `<span class="badge ${statusClass(c.status)}">${c.status}</span>` : '—'}</td>
      <td>${c.leadAssignee ? `<span class="assignee-chip"><span class="chip-dot"></span>${c.leadAssignee}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td>${c.techAssignee ? `<span class="assignee-chip"><span class="chip-dot" style="background:var(--blue)"></span>${c.techAssignee}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td class="text-sm text-muted">${fmtDate(c.startDate)}</td>
      <td><button class="btn-view" onclick="openModal('${c.id}')">View →</button></td>
    </tr>`;
  }).join('');
}

['client-search', 'filter-status', 'filter-program', 'filter-assignee'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => { if (activeTab === 'clients') renderClients(); });
});

/* ── By Program ───────────────────────────────────────────────────────────── */
function renderPrograms() {
  const statusF = document.getElementById('prog-filter-status').value;
  const list    = clients.filter(c => !statusF || c.status === statusF);
  document.getElementById('programs-subtitle').textContent = `${list.length} clients`;

  const grouped = {};
  list.forEach(c => {
    const key = c.program || 'Unassigned';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  const order = ['Full Brand OS', 'Phase 1 Setup', 'Content', 'Ads Management', 'Website', 'Custom', 'Unassigned'];
  document.getElementById('prog-view-container').innerHTML = order
    .filter(k => grouped[k]?.length)
    .map(k => {
      const grp   = grouped[k];
      const color = progColor(k);
      const cards = grp.map(c => {
        const dur   = progDuration(c.program);
        const wk    = Math.min(c.currentWeek || 1, dur);
        const pct   = Math.round((wk / dur) * 100);
        const phase = getPhaseLabel(c.program, wk);
        return `<div class="prog-client-card" onclick="openModal('${c.id}')">
          <div class="prog-card-top">
            <div>
              <div class="prog-card-name">${c.name}</div>
              <div class="prog-card-biz">${c.businessName || c.email}</div>
            </div>
            <span class="badge ${statusClass(c.status)}">${c.status || '—'}</span>
          </div>
          ${phase ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${phase}</div>` : ''}
          <div style="background:var(--surface2);border-radius:4px;height:6px;margin-bottom:8px">
            <div style="width:${pct}%;height:100%;border-radius:4px;background:${color}"></div>
          </div>
          <div class="prog-card-meta">
            <span>Week ${wk} / ${dur}</span>
            <div style="display:flex;gap:6px">
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
    }).join('');
}

document.getElementById('prog-filter-status').addEventListener('change', () => { if (activeTab === 'programs') renderPrograms(); });

/* ── Analytics ────────────────────────────────────────────────────────────── */
function renderAnalytics() {
  document.getElementById('analytics-subtitle').textContent = `${clients.length} clients total`;
  renderChart('chart-a-programs', 'doughnut', programChartData());
  renderChart('chart-a-status',   'doughnut', statusChartData());

  const leadCounts = {};
  clients.forEach(c => { const k = c.leadAssignee || 'Unassigned'; leadCounts[k] = (leadCounts[k] || 0) + 1; });
  renderChart('chart-a-lead', 'bar', { labels: Object.keys(leadCounts), datasets: [{ label: 'Clients', data: Object.values(leadCounts), backgroundColor: '#22c55e88', borderColor: '#22c55e', borderWidth: 1 }] });

  const techCounts = {};
  clients.forEach(c => { const k = c.techAssignee || 'Unassigned'; techCounts[k] = (techCounts[k] || 0) + 1; });
  renderChart('chart-a-tech', 'bar', { labels: Object.keys(techCounts), datasets: [{ label: 'Clients', data: Object.values(techCounts), backgroundColor: '#f59e0b88', borderColor: '#f59e0b', borderWidth: 1 }] });

  renderWeekTimeline('analytics-timeline', clients.filter(c => c.status === 'Active' || c.status === 'Onboarding'));
}

/* ── New Intakes ──────────────────────────────────────────────────────────── */
function renderIntakes() {
  const intakes = clients.filter(c => c.status === 'Intake Received');
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
  modalViewWeek = modalClient.currentWeek || 1;
  modalChecklistData = {};
  populateModal();
  document.getElementById('client-modal').classList.remove('hidden');
  loadChecklist(modalViewWeek);
}

function populateModal() {
  const c = modalClient;

  document.getElementById('cm-avatar').textContent = initials(c.name);
  document.getElementById('cm-name').textContent   = c.name;
  document.getElementById('cm-biz').textContent    = c.businessName || c.email;

  const prog = PROGRAMS[c.program];
  const badge = document.getElementById('cm-prog-badge');
  if (prog) {
    badge.textContent = prog.label;
    badge.style.background = prog.color + '22';
    badge.style.color = prog.color;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  const sBadge = document.getElementById('cm-status-badge');
  sBadge.textContent = c.status || '—';
  sBadge.className = `badge ${statusClass(c.status)}`;

  // Contact
  const emailEl = document.getElementById('cm-email');
  emailEl.textContent = c.email || '—';
  emailEl.href = c.email ? `mailto:${c.email}` : '#';
  document.getElementById('cm-phone').textContent = c.phone || '—';
  document.getElementById('cm-insta').textContent = c.instagram || '—';

  const websiteEl    = document.getElementById('cm-website');
  const websiteEmpty = document.getElementById('cm-website-empty');
  if (c.website) {
    websiteEl.href = c.website; websiteEl.textContent = c.website;
    websiteEl.classList.remove('hidden'); websiteEmpty.classList.add('hidden');
  } else {
    websiteEl.classList.add('hidden'); websiteEmpty.classList.remove('hidden');
  }

  // Program fields
  document.getElementById('cm-program').value = c.program || '';
  document.getElementById('cm-status').value  = c.status || '';
  document.getElementById('cm-week').value    = c.currentWeek || 1;
  document.getElementById('cm-start').value   = c.startDate || '';
  document.getElementById('cm-lead').value    = c.leadAssignee || '';
  document.getElementById('cm-tech').value    = c.techAssignee || '';

  // Content
  document.getElementById('cm-notes').value    = c.notes || '';
  document.getElementById('cm-brand').value    = c.brandDirection || '';
  document.getElementById('cm-services').value = c.servicesAndPricing || '';
  document.getElementById('cm-goals').value    = [c.targetAudience ? 'Audience: ' + c.targetAudience : '', c.goals || ''].filter(Boolean).join('\n');
  document.getElementById('cm-filming').value  = c.filmingAvailability || '';

  document.getElementById('modal-save-msg').textContent = '';
  document.getElementById('cm-note-msg').textContent    = '';
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('client-modal').classList.add('hidden');
});
document.getElementById('client-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('client-modal'))
    document.getElementById('client-modal').classList.add('hidden');
});

/* ── Checklist (live Airtable) ────────────────────────────────────────────── */
async function loadChecklist(week) {
  const c = modalClient;
  if (!c) return;

  // Only load if not already cached
  if (modalChecklistData[week]) { renderChecklist(week); return; }

  setChecklistLoading(true);

  const defs = CHECKLIST_DEFS[week];
  if (!defs) {
    // Weeks > 4 use the hardcoded program notes only — no Airtable table
    modalChecklistData[week] = { fields: {}, recordId: null, noTable: true };
    renderChecklist(week);
    return;
  }

  try {
    const res = await fetch(`/api/clients/${c.id}/checklist/${week}`);
    const data = await res.json();
    modalChecklistData[week] = data;
  } catch {
    modalChecklistData[week] = { fields: {}, recordId: null };
  }

  setChecklistLoading(false);
  renderChecklist(week);
}

function setChecklistLoading(on) {
  document.getElementById('cl-gathr').innerHTML  = on ? '<p style="color:var(--text3);font-size:12px;padding:8px 0">Loading…</p>' : '';
  document.getElementById('cl-client').innerHTML = '';
}

function renderChecklist(week) {
  const wk    = week || modalViewWeek;
  const title = WEEK_TITLES[wk] || `Week ${wk}`;
  document.getElementById('cl-week-title').textContent = title;
  document.getElementById('cl-week-display').textContent = `Week ${wk}`;

  const maxWeek = progDuration(modalClient?.program);
  document.getElementById('cl-prev').disabled = wk <= 1;
  document.getElementById('cl-next').disabled = wk >= maxWeek;

  const phase = getPhaseLabel(modalClient?.program, wk);
  document.getElementById('cl-phase-label').textContent = phase || '';

  const defs = CHECKLIST_DEFS[wk];
  const data = modalChecklistData[wk] || {};

  if (!defs || data.noTable) {
    // No dedicated Airtable table for this week — show placeholder
    document.getElementById('cl-gathr').innerHTML = '<p style="color:var(--text3);font-size:12px;padding:8px 0">Checklist not configured for this week yet. Add more P2/P3/P4 tables in Airtable to unlock.</p>';
    document.getElementById('cl-client').innerHTML = '';
    document.getElementById('checklist-section-gathr').style.display = 'none';
    document.getElementById('checklist-section-client').style.display = 'none';
    return;
  }

  document.getElementById('checklist-section-gathr').style.display = '';
  document.getElementById('checklist-section-client').style.display = 'none'; // P1 uses single list per week

  const fields = data.fields || {};
  const recordId = data.recordId || null;

  document.getElementById('cl-gathr').innerHTML = defs.map(({ field, label }) => {
    const done = !!fields[field];
    const disabled = !recordId ? 'style="opacity:.5;pointer-events:none"' : '';
    return `<div class="checklist-item" ${disabled} onclick="toggleCheck(${wk},'${field}',${!done})">
      <div class="check-box ${done ? 'checked' : ''}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
      </div>
      <span class="check-label ${done ? 'done' : ''}">${label} <span style="font-size:10px;color:var(--text3)">(${field})</span></span>
    </div>`;
  }).join('');

  document.getElementById('cl-client').innerHTML = '';
}

async function toggleCheck(week, field, newValue) {
  const data = modalChecklistData[week];
  if (!data?.recordId) return;

  // Optimistic update
  data.fields[field] = newValue;
  renderChecklist(week);

  try {
    const res = await fetch(`/api/checklist/${week}/${data.recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value: newValue }),
    });
    const updated = await res.json();
    if (updated.fields) {
      modalChecklistData[week].fields = updated.fields;
      renderChecklist(week);
    }
  } catch (e) {
    // Revert on error
    data.fields[field] = !newValue;
    renderChecklist(week);
    console.error('toggleCheck failed', e);
  }
}

document.getElementById('cl-prev').addEventListener('click', () => {
  modalViewWeek--;
  loadChecklist(modalViewWeek);
});
document.getElementById('cl-next').addEventListener('click', () => {
  modalViewWeek++;
  loadChecklist(modalViewWeek);
});

/* ── Save client ──────────────────────────────────────────────────────────── */
document.getElementById('btn-save-client').addEventListener('click', async () => {
  const c = modalClient;
  const patch = {
    program:           document.getElementById('cm-program').value,
    status:            document.getElementById('cm-status').value,
    currentWeek:       parseInt(document.getElementById('cm-week').value) || 1,
    startDate:         document.getElementById('cm-start').value,
    leadAssignee:      document.getElementById('cm-lead').value,
    techAssignee:      document.getElementById('cm-tech').value,
    notes:             document.getElementById('cm-notes').value,
    brandDirection:    document.getElementById('cm-brand').value,
    servicesAndPricing:document.getElementById('cm-services').value,
    goals:             document.getElementById('cm-goals').value,
    filmingAvailability:document.getElementById('cm-filming').value,
  };

  const msgEl = document.getElementById('modal-save-msg');
  msgEl.textContent = 'Saving…';
  msgEl.style.color = 'var(--accent)';

  const updated = await patchClient(c.id, patch);
  if (updated) {
    Object.assign(c, updated);
    const idx = clients.findIndex(x => x.id === c.id);
    if (idx !== -1) clients[idx] = updated;
    msgEl.textContent = '✓ Saved to Airtable';
    setTimeout(() => msgEl.textContent = '', 3000);
    populateModal();
  } else {
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = 'Error saving — check console';
  }
});

document.getElementById('cm-save-note').addEventListener('click', async () => {
  const notes = document.getElementById('cm-notes').value;
  const msgEl = document.getElementById('cm-note-msg');
  msgEl.textContent = 'Saving…';
  const updated = await patchClient(modalClient.id, { notes });
  if (updated) {
    Object.assign(modalClient, updated);
    msgEl.textContent = '✓ Saved';
    setTimeout(() => msgEl.textContent = '', 2500);
  }
});

document.getElementById('cm-program').addEventListener('change', () => {
  if (!modalClient) return;
  modalClient.program = document.getElementById('cm-program').value;
  modalViewWeek = 1;
  const prog  = PROGRAMS[modalClient.program];
  const badge = document.getElementById('cm-prog-badge');
  if (prog) { badge.textContent = prog.label; badge.style.background = prog.color + '22'; badge.style.color = prog.color; badge.style.display = 'inline-block'; }
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

/* ── Boot ─────────────────────────────────────────────────────────────────── */
checkAuth();
