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
    weeks: {
      1: { gathr: ['Intake call to capture branding direction','First filming session (non-negotiable — content must be ready by Week 4)','Bio optimisation begins','Weekly WIG meeting begins'], client: ['Complete intake form before the call','Show up to intake call and filming session prepared','Attend first weekly WIG meeting','Build a list of everyone you know (network list)'] },
      2: { gathr: ['Software build — funnel, automations, 2 pipelines','Business number, sending domain, integrated domain','Booking calendar and integrations (per checklist)','Weekly WIG meeting'], client: ['Contact list ready for uploading','Attend weekly WIG meeting'] },
      3: { gathr: ['Review/revision call on the completed build','Revisions made','Weekly WIG meeting'], client: ['Attend review call and give direct feedback','Finalise personal network list','Attend weekly WIG meeting'] },
      4: { gathr: ['1:1 onboarding session delivered and recorded','SOPs / playbook sent','Client booked into weekly tech-support calls','Content for Weeks 4–8 scheduled','Weekly WIG meeting'], client: ['Actively participate in 1:1 training','Demonstrate you can use the system','Commit to weekly tech-call cadence','Network list ready to load'] },
      5: { gathr: ['Weekly WIG + tech-support call','Content filmed, edited and scheduled','First 3 posts are pinned posts','Pipeline and automations supporting outreach'], client: ['Begin warm outreach to personal network (30 contacts)','Post 5×/week','Log every conversation in the pipeline','Book and run complimentary sessions'] },
      6: { gathr: ['Weekly WIG + tech support','Ongoing content production and scheduling'], client: ['Continue network outreach','Start conversations with new followers','Keep posting, logging, nurturing, booking and closing','Reach out to 30 network + all followers'] },
      7: { gathr: ['Weekly WIG + tech support','Coaching focus: diagnose the funnel — booked → showed → closed'], client: ['Maintain outreach volume','Track booked / showed / closed and fix weakest stage','Keep booking and closing'] },
      8: { gathr: ['Weekly WIG + tech support','Second content batch filmed for Weeks 8–12','Coaching focus: the warm-list transition'], client: ['Shift outreach toward followers','Prepare for business outreach as network list empties','Ask happy comp clients for referrals','Keep booking and closing'] },
      9: { gathr: ['Weekly WIG + tech support','Coaching focus: lift the close rate'], client: ['Continue outreach to followers and local businesses','Book and close comp sessions','Develop your talk topic and format'] },
      10: { gathr: ['Weekly WIG + tech support','Ongoing content production'], client: ['Keep outreach to followers and businesses','Book and close','Shape your talk and closing ask for the event','Run one engagement campaign'] },
      11: { gathr: ['Weekly WIG + tech support','Teach the engagement campaign on Meta'], client: ['Continue outreach and closing','Begin applying engagement-campaign skills','Reach out to 5 followers + 7 businesses'] },
      12: { gathr: ['Weekly WIG + tech support','Teach instant-forms lead-gen campaign','Set up to run in tandem'], client: ['Continue outreach and closing','Build your event registration form','Reach out to 5 followers + 7 businesses'] },
      13: { gathr: ['Weekly WIG + tech support','Help confirm event logistics','Prepare to run instant-forms campaign in tandem'], client: ['Choose and confirm event date and format','Launch engagement campaign to generate interest'] },
      14: { gathr: ['Weekly WIG + tech support','Run instant-forms lead-gen campaign to qualify registrations'], client: ['Reach out to every lead about the event','Drive registrations','Set your reminder sequence'] },
      15: { gathr: ['Weekly WIG + tech support','Support final event prep','Capture content on the day'], client: ['Final fill and prep','Run your session','Make your offer on the night','Capture content for you and for Gathr'] },
      16: { gathr: ['Final WIG / review meeting','Help follow up registrants and review results'], client: ['Follow up with everyone — attendees and no-shows','Convert leads','Decide your next step with Gathr'] },
    },
  },
  'Phase 1 Setup': {
    label: 'Phase 1 — Setup', duration: 4, price: '$1,500', color: '#3b82f6',
    phases: [{ name: 'Weeks 1–4 · Build the Foundation', weeks: [1,2,3,4] }],
    weeks: {
      1: { gathr: ['Intake call to capture branding direction and requirements','Bio optimisation begins from intake form'], client: ['Complete intake form ahead of call','Show up prepared with direction and assets','Gather brand assets (logo, links, booking preferences, services & pricing)'] },
      2: { gathr: ['Software build — funnel, automations, 2 pipelines','Business number, sending domain, integrated domain','Booking calendar and integrations (per checklist)'], client: ['Provide any access/details required for the build (domain, socials)','Review progress as shared','Get contact list ready to load'] },
      3: { gathr: ['Review/revision call on completed build','Revisions made'], client: ['Attend review call and give direct feedback','Confirm sign-off once revisions are complete'] },
      4: { gathr: ['1:1 onboarding session delivered and recorded','SOPs / playbook sent','Client booked into weekly tech-support calls'], client: ['Actively participate in 1:1 training','Demonstrate you can use the system','Commit to weekly tech-call cadence'] },
    },
  },
  'Content': {
    label: 'Content', duration: 1, price: '$1,000–$1,500/mo', color: '#f59e0b',
    phases: [{ name: 'Monthly Content Production', weeks: [1] }],
    weeks: {
      1: { gathr: ['Plan monthly content around your brand','Run filming session(s)','Edit every reel ready to post','Deliver 4 hero reels + 8 basic reels + 8 short branded reels + 5 photos'], client: ['Show up to filming prepared','Provide brand direction & talking points','Review and approve content'] },
    },
  },
  'Ads Management': {
    label: 'Ads Management', duration: 1, price: '$1,000–$1,500/mo', color: '#ef4444',
    phases: [{ name: 'Monthly Ad Management', weeks: [1] }],
    weeks: {
      1: { gathr: ['Build, launch & manage ad campaigns','Ongoing optimisation & reporting','Weekly WIG accountability meetings','(Tier 2) Script & edit 5 new ads each month'], client: ['Maintain strong brand, 1,000+ followers & offer','Attend weekly WIG meetings','(Tier 2) Film the 5 scripted ads each month'] },
    },
  },
  'Website': {
    label: 'Website', duration: 1, price: '$3,500', color: '#14b8a6',
    phases: [{ name: 'Website Build', weeks: [1] }],
    weeks: {
      1: { gathr: ['Design the full site','Build & develop every page','Launch it live & on-brand'], client: ['Provide brand assets & content direction','Supply copy / photos (or brief us)','Review & approve before launch'] },
    },
  },
  'Custom': {
    label: 'Custom / Hourly', duration: 1, price: 'Custom quote', color: '#6b7280',
    phases: [{ name: 'Custom Work', weeks: [1] }],
    weeks: {
      1: { gathr: ['Consultation call','Clear scope & fair quote','Agreed work, delivered'], client: ['Brief us clearly on what you need','Approve the quote to begin'] },
    },
  },
};

/* ── State ────────────────────────────────────────────────────────────────── */
let clients = [];
let team = [];
let activeTab = 'overview';
let modalClient = null;
let modalViewWeek = 1;
let charts = {};

/* ── Utils ────────────────────────────────────────────────────────────────── */
function initials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function statusClass(s) {
  const m = { 'Active': 'badge-active', 'Paused': 'badge-paused', 'Completed': 'badge-completed', 'Intake Received': 'badge-intake', 'Onboarding': 'badge-onboarding' };
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

  const addTeamOptions = (selId) => {
    const s = document.getElementById(selId);
    s.innerHTML = '<option value="">— Unassigned —</option>';
    team.forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      s.appendChild(o);
    });
  };
  addTeamOptions('cm-lead');
  addTeamOptions('cm-tech');
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
function renderOverview() {
  const active = clients.filter(c => c.status === 'Active').length;
  const intake = clients.filter(c => c.status === 'Intake Received').length;
  const paused = clients.filter(c => c.status === 'Paused').length;
  const completed = clients.filter(c => c.status === 'Completed').length;

  document.getElementById('kpi-active').textContent = active;
  document.getElementById('kpi-intake').textContent = intake;
  document.getElementById('kpi-paused').textContent = paused;
  document.getElementById('kpi-completed').textContent = completed;
  document.getElementById('kpi-active-sub').textContent = `${clients.length} total`;
  document.getElementById('overview-subtitle').textContent = `Last updated ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;

  renderWeekTimeline('week-timeline-container', clients.filter(c => c.status === 'Active'));
  renderChart('chart-programs', 'doughnut', programChartData());
  renderChart('chart-status', 'doughnut', statusChartData());
}

/* ── Week timeline ────────────────────────────────────────────────────────── */
function renderWeekTimeline(containerId, list) {
  const wrap = document.getElementById(containerId);
  if (!list.length) { wrap.innerHTML = '<p style="color:var(--text3);font-size:13px;text-align:center;padding:20px 0">No active clients yet.</p>'; return; }

  wrap.innerHTML = list.map(c => {
    const dur = progDuration(c.program) || 1;
    const week = Math.min(c.currentWeek || 1, dur);
    const pct = (week / dur) * 100;
    const color = progColor(c.program);
    const phase = getPhaseLabel(c.program, week);
    return `<div class="wt-row" style="margin-bottom:6px">
      <div class="wt-name" title="${c.name}">${c.name}</div>
      <div class="wt-track" style="flex:1;height:26px;background:var(--surface2);border-radius:6px;position:relative;overflow:hidden;cursor:pointer" onclick="openModal('${c.id}')">
        <div class="wt-fill" style="width:${pct}%;height:100%;background:${color};opacity:.85;border-radius:6px;display:flex;align-items:center;padding-left:8px">
          ${pct > 15 ? `<span style="font-size:11px;font-weight:700;color:rgba(0,0,0,.75)">${phase || c.program}</span>` : ''}
        </div>
      </div>
      <div class="wt-week-label">Wk ${week}/${dur}</div>
    </div>`;
  }).join('');
}

/* ── Chart helpers ────────────────────────────────────────────────────────── */
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
  clients.forEach(c => { counts[c.program || 'Unknown'] = (counts[c.program || 'Unknown'] || 0) + 1; });
  const labels = Object.keys(counts);
  return {
    labels,
    datasets: [{ data: Object.values(counts), backgroundColor: labels.map(l => progColor(l)), borderWidth: 0 }],
  };
}

function statusChartData() {
  const counts = {};
  clients.forEach(c => { counts[c.status || 'Unknown'] = (counts[c.status || 'Unknown'] || 0) + 1; });
  const colors = { Active: '#22c55e', Paused: '#f59e0b', Completed: '#3b82f6', 'Intake Received': '#8b5cf6', Onboarding: '#14b8a6', Unknown: '#6b7280' };
  const labels = Object.keys(counts);
  return {
    labels,
    datasets: [{ data: Object.values(counts), backgroundColor: labels.map(l => colors[l] || '#6b7280'), borderWidth: 0 }],
  };
}

/* ── Clients table ────────────────────────────────────────────────────────── */
function renderClients() {
  const search = (document.getElementById('client-search').value || '').toLowerCase();
  const statusF = document.getElementById('filter-status').value;
  const progF = document.getElementById('filter-program').value;
  const assigneeF = document.getElementById('filter-assignee').value;

  let list = clients.filter(c => {
    if (statusF && c.status !== statusF) return false;
    if (progF && c.program !== progF) return false;
    if (assigneeF && c.leadAssignee !== assigneeF && c.techAssignee !== assigneeF) return false;
    if (search) {
      const hay = `${c.name} ${c.businessName} ${c.email}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const total = list.length;
  document.getElementById('clients-subtitle').textContent = `${total} client${total !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('client-tbody');
  const empty = document.getElementById('client-empty');

  if (!list.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const dur = c => progDuration(c.program);
  const week = c => Math.min(c.currentWeek || 1, dur(c));
  const pct = c => Math.round((week(c) / dur(c)) * 100);
  const color = c => progColor(c.program);

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>
        <div class="name-cell">
          <div class="avatar">${initials(c.name)}</div>
          <div>
            <strong>${c.name}</strong>
            <small>${c.businessName || c.email}</small>
          </div>
        </div>
      </td>
      <td>
        ${c.program ? `<span class="prog-badge" style="background:${color(c)}22;color:${color(c)}">${c.program}</span>` : '<span class="text-muted text-sm">—</span>'}
      </td>
      <td style="min-width:140px">
        <div class="week-progress">
          <span class="week-label">Wk ${week(c)}/${dur(c)}</span>
          <div class="progress-bar-wrap" style="width:80px">
            <div class="progress-bar-fill" style="width:${pct(c)}%;background:${color(c)}"></div>
          </div>
        </div>
      </td>
      <td><span class="badge ${statusClass(c.status)}">${c.status}</span></td>
      <td>${c.leadAssignee ? `<span class="assignee-chip"><span class="chip-dot"></span>${c.leadAssignee}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td>${c.techAssignee ? `<span class="assignee-chip" style="--chip-dot-color:var(--blue)"><span class="chip-dot" style="background:var(--blue)"></span>${c.techAssignee}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
      <td class="text-sm text-muted">${fmtDate(c.startDate)}</td>
      <td><button class="btn-view" onclick="openModal('${c.id}')">View →</button></td>
    </tr>
  `).join('');
}

['client-search', 'filter-status', 'filter-program', 'filter-assignee'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => { if (activeTab === 'clients') renderClients(); });
});

/* ── By Program ───────────────────────────────────────────────────────────── */
function renderPrograms() {
  const statusF = document.getElementById('prog-filter-status').value;

  let list = clients.filter(c => !statusF || c.status === statusF);
  document.getElementById('programs-subtitle').textContent = `${list.length} clients`;

  const grouped = {};
  list.forEach(c => {
    const key = c.program || 'Unassigned';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  const order = ['Full Brand OS', 'Phase 1 Setup', 'Content', 'Ads Management', 'Website', 'Custom', 'Unassigned'];
  const container = document.getElementById('prog-view-container');
  container.innerHTML = order
    .filter(k => grouped[k] && grouped[k].length)
    .map(k => {
      const grp = grouped[k];
      const color = progColor(k);
      const cards = grp.map(c => {
        const dur = progDuration(c.program);
        const wk = Math.min(c.currentWeek || 1, dur);
        const pct = Math.round((wk / dur) * 100);
        const phase = getPhaseLabel(c.program, wk);
        return `<div class="prog-client-card" onclick="openModal('${c.id}')">
          <div class="prog-card-top">
            <div>
              <div class="prog-card-name">${c.name}</div>
              <div class="prog-card-biz">${c.businessName || c.email}</div>
            </div>
            <span class="badge ${statusClass(c.status)}">${c.status}</span>
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
  renderChart('chart-a-status', 'doughnut', statusChartData());

  // By lead assignee
  const leadCounts = {};
  clients.forEach(c => { const k = c.leadAssignee || 'Unassigned'; leadCounts[k] = (leadCounts[k] || 0) + 1; });
  renderChart('chart-a-lead', 'bar', {
    labels: Object.keys(leadCounts),
    datasets: [{ label: 'Clients', data: Object.values(leadCounts), backgroundColor: '#22c55e88', borderColor: '#22c55e', borderWidth: 1 }],
  });

  // By tech assignee
  const techCounts = {};
  clients.forEach(c => { const k = c.techAssignee || 'Unassigned'; techCounts[k] = (techCounts[k] || 0) + 1; });
  renderChart('chart-a-tech', 'bar', {
    labels: Object.keys(techCounts),
    datasets: [{ label: 'Clients', data: Object.values(techCounts), backgroundColor: '#f59e0b88', borderColor: '#f59e0b', borderWidth: 1 }],
  });

  const active = clients.filter(c => c.status === 'Active' || c.status === 'Onboarding');
  renderWeekTimeline('analytics-timeline', active);
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
      <td>
        <div class="name-cell">
          <div class="avatar" style="background:var(--purple-dim);color:var(--purple)">${initials(c.name)}</div>
          <div><strong>${c.name}</strong><small>${c.email}</small></div>
        </div>
      </td>
      <td class="text-sm">${c.businessName || '—'}</td>
      <td class="text-sm text-muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.goals || '—'}</td>
      <td class="text-sm text-muted">${fmtDate(c.intakeSubmitted)}</td>
      <td><span class="badge badge-intake">Intake Received</span></td>
      <td><button class="btn-view" onclick="openModal('${c.id}')">Review →</button></td>
    </tr>
  `).join('');
}

/* ── Modal ────────────────────────────────────────────────────────────────── */
function openModal(id) {
  modalClient = clients.find(c => c.id === id);
  if (!modalClient) return;
  modalViewWeek = modalClient.currentWeek || 1;
  populateModal();
  document.getElementById('client-modal').classList.remove('hidden');
}

function populateModal() {
  const c = modalClient;

  document.getElementById('cm-avatar').textContent = initials(c.name);
  document.getElementById('cm-name').textContent = c.name;
  document.getElementById('cm-biz').textContent = c.businessName || c.email;

  const prog = PROGRAMS[c.program];
  const progBadge = document.getElementById('cm-prog-badge');
  if (prog) {
    progBadge.textContent = prog.label;
    progBadge.style.background = prog.color + '22';
    progBadge.style.color = prog.color;
    progBadge.style.display = 'inline-block';
  } else {
    progBadge.style.display = 'none';
  }

  const statusBadge = document.getElementById('cm-status-badge');
  statusBadge.textContent = c.status;
  statusBadge.className = `badge ${statusClass(c.status)}`;

  // Contact
  const emailEl = document.getElementById('cm-email');
  emailEl.textContent = c.email || '—';
  emailEl.href = c.email ? `mailto:${c.email}` : '#';

  document.getElementById('cm-phone').textContent = c.phone || '—';
  document.getElementById('cm-insta').textContent = c.instagram || '—';

  const websiteEl = document.getElementById('cm-website');
  const websiteEmpty = document.getElementById('cm-website-empty');
  if (c.website) {
    websiteEl.href = c.website;
    websiteEl.textContent = c.website;
    websiteEl.classList.remove('hidden');
    websiteEmpty.classList.add('hidden');
  } else {
    websiteEl.classList.add('hidden');
    websiteEmpty.classList.remove('hidden');
  }

  // Program fields
  document.getElementById('cm-program').value = c.program || '';
  document.getElementById('cm-status').value = c.status || '';
  document.getElementById('cm-week').value = c.currentWeek || 1;
  document.getElementById('cm-start').value = c.startDate || '';
  document.getElementById('cm-lead').value = c.leadAssignee || '';
  document.getElementById('cm-tech').value = c.techAssignee || '';

  // Notes / brand info
  document.getElementById('cm-notes').value = c.notes || '';
  document.getElementById('cm-brand').value = c.brandDirection || '';
  document.getElementById('cm-services').value = c.servicesAndPricing || '';
  document.getElementById('cm-goals').value = `${c.targetAudience ? 'Audience: ' + c.targetAudience + '\n' : ''}${c.goals || ''}`;
  document.getElementById('cm-filming').value = c.filmingAvailability || '';

  document.getElementById('modal-save-msg').textContent = '';
  document.getElementById('cm-note-msg').textContent = '';

  renderChecklist();
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('client-modal').classList.add('hidden');
});
document.getElementById('client-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('client-modal')) document.getElementById('client-modal').classList.add('hidden');
});

/* ── Checklist ────────────────────────────────────────────────────────────── */
function renderChecklist() {
  const c = modalClient;
  const prog = PROGRAMS[c.program];
  const maxWeek = prog ? prog.duration : 1;
  const wk = Math.min(Math.max(modalViewWeek, 1), maxWeek);
  modalViewWeek = wk;

  document.getElementById('cl-week-title').textContent = `Week ${wk} Checklist`;
  document.getElementById('cl-week-display').textContent = `Week ${wk}`;
  document.getElementById('cl-prev').disabled = wk <= 1;
  document.getElementById('cl-next').disabled = wk >= maxWeek;

  const phase = getPhaseLabel(c.program, wk);
  document.getElementById('cl-phase-label').textContent = phase || '';

  const weekData = prog ? (prog.weeks[wk] || { gathr: [], client: [] }) : { gathr: [], client: [] };
  const state = c.checklistState || {};
  const weekState = state[wk] || {};

  function renderItems(items, type, container) {
    const el = document.getElementById(container);
    el.innerHTML = items.map((item, i) => {
      const key = `${type}_${i}`;
      const done = !!weekState[key];
      return `<div class="checklist-item" onclick="toggleCheck(${wk},'${key}')">
        <div class="check-box ${done ? 'checked' : ''}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg>
        </div>
        <span class="check-label ${done ? 'done' : ''}">${item}</span>
      </div>`;
    }).join('');
  }

  renderItems(weekData.gathr, 'g', 'cl-gathr');
  renderItems(weekData.client, 'c', 'cl-client');
}

function toggleCheck(week, key) {
  const c = modalClient;
  if (!c.checklistState) c.checklistState = {};
  if (!c.checklistState[week]) c.checklistState[week] = {};
  c.checklistState[week][key] = !c.checklistState[week][key];
  renderChecklist();
  // Auto-save checklist state
  patchClient(c.id, { checklistState: c.checklistState });
}

document.getElementById('cl-prev').addEventListener('click', () => { modalViewWeek--; renderChecklist(); });
document.getElementById('cl-next').addEventListener('click', () => { modalViewWeek++; renderChecklist(); });

/* ── Save client ──────────────────────────────────────────────────────────── */
document.getElementById('btn-save-client').addEventListener('click', async () => {
  const c = modalClient;
  const goalsRaw = document.getElementById('cm-goals').value;

  const patch = {
    program: document.getElementById('cm-program').value,
    status: document.getElementById('cm-status').value,
    currentWeek: parseInt(document.getElementById('cm-week').value) || 1,
    startDate: document.getElementById('cm-start').value,
    leadAssignee: document.getElementById('cm-lead').value,
    techAssignee: document.getElementById('cm-tech').value,
    notes: document.getElementById('cm-notes').value,
    brandDirection: document.getElementById('cm-brand').value,
    servicesAndPricing: document.getElementById('cm-services').value,
    goals: goalsRaw,
    filmingAvailability: document.getElementById('cm-filming').value,
    checklistState: c.checklistState || {},
  };

  const msgEl = document.getElementById('modal-save-msg');
  msgEl.textContent = 'Saving…';
  const updated = await patchClient(c.id, patch);
  if (updated) {
    Object.assign(c, updated);
    msgEl.textContent = '✓ Saved to Airtable';
    setTimeout(() => msgEl.textContent = '', 3000);
    // Refresh local data
    const idx = clients.findIndex(x => x.id === c.id);
    if (idx !== -1) clients[idx] = updated;
    populateModal();
  } else {
    msgEl.style.color = 'var(--red)';
    msgEl.textContent = 'Error — check console';
  }
});

document.getElementById('cm-save-note').addEventListener('click', async () => {
  const c = modalClient;
  const notes = document.getElementById('cm-notes').value;
  const msgEl = document.getElementById('cm-note-msg');
  msgEl.textContent = 'Saving…';
  const updated = await patchClient(c.id, { notes });
  if (updated) {
    Object.assign(c, updated);
    msgEl.textContent = '✓ Saved';
    setTimeout(() => msgEl.textContent = '', 2500);
  }
});

// Re-render checklist when program changes
document.getElementById('cm-program').addEventListener('change', () => {
  if (modalClient) {
    modalClient.program = document.getElementById('cm-program').value;
    modalViewWeek = 1;
    renderChecklist();
    // Update prog badge
    const prog = PROGRAMS[modalClient.program];
    const badge = document.getElementById('cm-prog-badge');
    if (prog) { badge.textContent = prog.label; badge.style.background = prog.color + '22'; badge.style.color = prog.color; badge.style.display = 'inline-block'; }
    else badge.style.display = 'none';
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

/* ── Boot ─────────────────────────────────────────────────────────────────── */
checkAuth();
