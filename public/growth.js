/* ── Gathr Grow (Growth tab) ──────────────────────────────────────────────────
   Self-contained client reporting / WIG scoreboard tool, ported from the
   standalone prototype. Everything lives inside this IIFE and is exposed only
   via window.Growth, so it cannot collide with the rest of the app's globals.
   All persistence goes through /api/growth/* instead of window.storage. */
(function () {
  let clients = [], dataCache = {}, cur = null, curSym = '£';

  const $   = id => document.getElementById('g-' + id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const money = (v, sym) => (v == null || isNaN(v)) ? '—' : (sym || '£') + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt$  = v => money(v, curSym);
  const fmtN  = v => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString();
  const fmtP  = v => (v == null || isNaN(v)) ? '—' : (Math.round(v * 10) / 10) + '%';
  const fmtP2 = v => (v == null || isNaN(v)) ? '—' : v.toFixed(2) + '%';
  const fmtP0 = v => (v == null || isNaN(v)) ? '—' : Math.round(v) + '%';
  const fmt2  = v => (v == null || isNaN(v)) ? '—' : v.toFixed(2);
  const fmtX  = v => (v == null || isNaN(v)) ? '—' : (Math.round(v * 100) / 100) + 'x';

  function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
  function setSync(s) { const el = $('syncStatus'); if (el) el.textContent = s; }

  // ── Persistence (server-backed) ───────────────────────────────────────────
  async function apiGet(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiSend(url, method, body) {
    try { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }
  function fresh() { return { board: null, periods: [], weeks: {}, months: {}, fees: {}, notes: {} }; }

  // One-time, idempotent migration: old model was one WIG + one commitment per
  // PERSON per period (2 points each). New model is a flat list of goals per
  // period, not tied to a person — each existing wig/commit text becomes its
  // own goal so nothing already typed in is lost. Coaching notes (hot/later/
  // renew/refer) stay on the person entry, just without the scoring fields.
  function migrateClientData(d) {
    let changed = false;
    (d.periods || []).forEach(p => {
      if (p.goals) return; // already migrated
      const goals = [];
      (p.people || []).forEach(pn => {
        if (pn.wig && pn.wig.trim()) goals.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), text: pn.wig.trim(), done: !!pn.wigDone });
        if (pn.commit && pn.commit.trim()) goals.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), text: pn.commit.trim(), done: !!pn.commitDone });
        delete pn.wig; delete pn.wigDone; delete pn.commit; delete pn.commitDone;
      });
      p.goals = goals;
      changed = true;
    });
    return changed;
  }

  // One-time, idempotent migration: the data pool used to be entered per
  // week (a reports person picking a Friday date). It's now entered per
  // month directly, so this sums whatever weekly entries already exist
  // into their month and moves them into d.months — nothing already
  // recorded is lost. Runs once per client: an empty {} still counts as
  // "already migrated", so this never re-sums after the switch.
  function migrateWeeksToMonths(d) {
    if (d.months) return false;
    d.months = {};
    Object.keys(d.weeks || {}).sort().forEach(k => {
      const w = d.weeks[k]; const mo = monthOf(k);
      if (!d.months[mo]) d.months[mo] = { ads: { spend: 0, impr: 0, clicks: 0, leads: 0 }, pipe: { booked: 0, showed: 0, closed: 0, rev: 0 } };
      const m = d.months[mo];
      if (w.ads) ['spend', 'impr', 'clicks', 'leads'].forEach(x => { if (w.ads[x] != null) m.ads[x] = (m.ads[x] || 0) + w.ads[x]; });
      if (w.pipe) ['booked', 'showed', 'closed', 'rev'].forEach(x => { if (w.pipe[x] != null) m.pipe[x] = (m.pipe[x] || 0) + w.pipe[x]; });
    });
    return true;
  }

  // One-time, idempotent migration: a month used to be one flat entry
  // (ads + pipe). Multiple campaigns can now run in the same month, so
  // each month becomes a list of named campaigns instead — an existing
  // month's numbers become its first campaign ("Campaign 1") so nothing
  // already recorded is lost. Runs once per month: once .campaigns exists
  // (even as an empty array), this never re-wraps it.
  function migrateMonthsToCampaigns(d) {
    let changed = false;
    Object.keys(d.months || {}).forEach(mo => {
      const m = d.months[mo];
      if (m.campaigns) return; // already migrated
      d.months[mo] = { campaigns: [{ id: 'camp_legacy_' + mo, name: 'Campaign 1', ads: m.ads || {}, pipe: m.pipe || {} }] };
      changed = true;
    });
    return changed;
  }

  // Housekeeping tasks are real tasks in the app's one shared task system
  // (My Tasks, assignee visibility, status — all identical), just tagged
  // with growthClientId/growthPeriodId so a period card can show its own
  // slice of them. Loaded as a flat list once and filtered per period at
  // render time, same pattern as everything else in this file.
  let housekeepingTasks = [];
  async function loadHousekeeping() { housekeepingTasks = (await apiGet('/api/tasks')) || []; }

  let booted = false;
  async function onOpen() {
    setSync('Loading…');
    clients = (await apiGet('/api/growth/clients')) || [];
    await loadHousekeeping();
    await Promise.all(clients.map(async c => {
      dataCache[c.id] = (await apiGet('/api/growth/data/' + c.id)) || fresh();
      const changed1 = migrateClientData(dataCache[c.id]);
      const changed2 = migrateWeeksToMonths(dataCache[c.id]);
      const changed3 = migrateMonthsToCampaigns(dataCache[c.id]);
      if (changed1 || changed2 || changed3) await apiSend('/api/growth/data/' + c.id, 'PUT', dataCache[c.id]);
    }));
    setSync('Synced · shared with your team');
    if (!booted) { booted = true; }
    // Stay on whichever client/tab was open, else show the dashboard
    if (cur && clients.some(c => c.id === cur)) {
      openClient(cur);
    } else {
      showDash();
    }
  }

  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function niceDate(s) { return s ? new Date(s + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long' }) : ''; }
  function shortDate(s) { return s ? new Date(s + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; }
  function monthOf(s) { return s.slice(0, 7); }
  function monthLabel(mo) { const [y, m] = mo.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y; }

  function monthKeys(d) { return Object.keys(d.months || {}).sort(); }
  function campaignsFor(d, mo) { return (d.months || {})[mo]?.campaigns || []; }
  // A single campaign's raw numbers, zero-filled for summing.
  function campaignRaw(c) {
    const s = { spend: 0, impr: 0, clicks: 0, leads: 0, booked: 0, showed: 0, closed: 0, rev: 0, any: false };
    if (c.ads) ['spend', 'impr', 'clicks', 'leads'].forEach(x => { if (c.ads[x] != null) { s[x] = c.ads[x]; s.any = true; } });
    if (c.pipe) ['booked', 'showed', 'closed', 'rev'].forEach(x => { if (c.pipe[x] != null) { s[x] = c.pipe[x]; s.any = true; } });
    return s;
  }
  // A month's raw numbers — the sum of every campaign that ran that month.
  // Everything downstream (monthAgg, totalAgg, longRun, the narrative
  // report) reads this, so multiple campaigns in one month just add up
  // exactly like a single campaign always did.
  function monthRaw(d, mo) {
    const s = { spend: 0, impr: 0, clicks: 0, leads: 0, booked: 0, showed: 0, closed: 0, rev: 0, any: false };
    campaignsFor(d, mo).forEach(c => {
      const r = campaignRaw(c);
      if (r.any) s.any = true;
      ['spend', 'impr', 'clicks', 'leads', 'booked', 'showed', 'closed', 'rev'].forEach(x => { s[x] += r[x] || 0; });
    });
    return s;
  }
  function sumAllMonths(d, f) {
    const s = { spend: 0, impr: 0, clicks: 0, leads: 0, booked: 0, showed: 0, closed: 0, rev: 0, any: false };
    monthKeys(d).filter(f).forEach(mo => {
      const r = monthRaw(d, mo);
      if (r.any) s.any = true;
      ['spend', 'impr', 'clicks', 'leads', 'booked', 'showed', 'closed', 'rev'].forEach(x => { s[x] += r[x] || 0; });
    });
    return s;
  }
  function deriveRates(s, fee) {
    const r = { ...s, fee };
    r.cpm = s.impr ? s.spend / s.impr * 1000 : null; r.ctr = s.impr ? s.clicks / s.impr * 100 : null;
    r.optin = s.clicks ? s.leads / s.clicks * 100 : null; r.cpl = s.leads ? s.spend / s.leads : null;
    r.bookPct = s.leads ? s.booked / s.leads * 100 : null; r.showPct = s.booked ? s.showed / s.booked * 100 : null;
    r.closePct = s.showed ? s.closed / s.showed * 100 : null;
    const inv = s.spend + (fee || 0);
    r.cac = s.closed ? s.spend / s.closed : null;   // CAC = ad spend / sales made (fee excluded)
    r.roas = s.spend ? s.rev / s.spend : null; r.roi = inv ? s.rev / inv : null;
    return r;
  }
  function clientFor(d) { const id = Object.keys(dataCache).find(k => dataCache[k] === d); return clients.find(c => c.id === id); }
  function feeFor(d, mo) { return d.fees[mo] != null ? d.fees[mo] : (clientFor(d)?.fee || 0); }
  function monthAgg(d, mo) { return deriveRates(monthRaw(d, mo), feeFor(d, mo)); }
  function totalAgg(d) { const mos = monthKeys(d); let fees = 0; mos.forEach(mo => { fees += feeFor(d, mo); }); return deriveRates(sumAllMonths(d, () => true), fees); }
  function longRun(d) {
    const s = sumAllMonths(d, () => true); const mos = monthKeys(d);
    let fees = 0; mos.forEach(mo => { fees += feeFor(d, mo); });
    const inv = s.spend + fees;
    return { roas: s.spend ? s.rev / s.spend : null, roi: inv ? s.rev / inv : null, cac: s.closed ? s.spend / s.closed : null, any: s.any };
  }
  // The big-picture WIG: a single number (X) by a date (Y), manually updated
  // in the weekly meeting with "where we're actually up to."
  function boardCurrent(d) { const b = d.board; if (!b) return null; return (b.current != null && !isNaN(b.current)) ? Number(b.current) : null; }
  function boardCalc(d) {
    const b = d.board; if (!b || !b.goal || !b.start || !b.end) return null;
    const total = Math.max(1, daysBetween(b.start, b.end)); const t = todayStr();
    const ref = t > b.end ? b.end : (t < b.start ? b.start : t); const done = Math.max(0, daysBetween(b.start, ref));
    const pacing = b.goal * done / total; const current = boardCurrent(d);
    return { total, done, pacing, current, winning: current != null ? current >= pacing : null };
  }
  // Where the board's pacing SHOULD be at an arbitrary date — used to work out
  // how many units are needed by the next weekly meeting to stay on track.
  function boardPacingAtDate(d, dateStr) {
    const b = d.board; if (!b || !b.goal || !b.start || !b.end || !dateStr) return null;
    const total = Math.max(1, daysBetween(b.start, b.end)); const dd = Math.min(Math.max(0, daysBetween(b.start, dateStr)), total);
    return b.goal * dd / total;
  }
  function openPeriod(d) { return (d.periods || []).find(p => !p.locked) || null; }
  // How many more units are needed by the next meeting (the current open
  // period's end date) to stay on pace for the overall WIG.
  function neededByNextMeeting(d) {
    const op = openPeriod(d); const bc = boardCalc(d); if (!op || !bc) return null;
    const target = boardPacingAtDate(d, op.end); if (target == null) return null;
    return Math.max(0, Math.ceil(target - (bc.current ?? 0)));
  }
  // Commitment % = goals hit ÷ goals set, across locked periods (client-level,
  // not tied to any one person — a client can have any number of goals per period).
  function commitPct(d) {
    let e = 0, p = 0; (d.periods || []).filter(pd => pd.locked).forEach(pd => (pd.goals || []).forEach(g => { p++; if (g.done) e++; }));
    return p ? e / p * 100 : null;
  }

  function roiClass(v) { return v == null ? '' : (v >= 1.5 ? 'roi-good' : v >= 1 ? 'roi-warn' : 'roi-bad'); }
  function metricClass(v) { return v == null ? '' : (v >= 1.5 ? 'good' : v >= 1 ? 'warn' : 'bad'); }

  function renderDash() {
    const grid = $('clientGrid'); if (!grid) return; grid.innerHTML = '';
    $('dashEmpty').classList.toggle('hidden', clients.length > 0);
    clients.forEach(c => {
      const d = dataCache[c.id] || fresh(); const lr = longRun(d); const bc = boardCalc(d); const cp = commitPct(d);
      const status = bc == null || bc.winning == null ? { c: 'idle', t: 'No scoreboard' } : (bc.winning ? { c: 'win', t: 'Winning' } : { c: 'lose', t: 'Losing' });
      const card = document.createElement('div');
      card.className = 'client-card ' + roiClass(lr.roi); card.tabIndex = 0; card.setAttribute('role', 'button');
      card.innerHTML = `
        <div class="cc-top"><h3>${esc(c.name)}</h3><span class="cc-status ${status.c}">${status.t}</span></div>
        <div class="cc-biz">${esc(c.business || 'Ads management')}</div>
        <div class="cc-metrics">
          <div class="cc-metric"><div class="m-lbl">CAC</div><div class="m-val">${money(lr.cac, c.currency)}</div></div>
          <div class="cc-metric"><div class="m-lbl">ROAS</div><div class="m-val">${fmtX(lr.roas)}</div></div>
          <div class="cc-metric"><div class="m-lbl">ROI</div><div class="m-val ${metricClass(lr.roi)}">${fmtX(lr.roi)}</div></div>
          <div class="cc-metric"><div class="m-lbl">Commit</div><div class="m-val">${cp != null ? Math.round(cp) + '%' : '—'}</div></div>
        </div>`;
      card.onclick = () => openClient(c.id); card.onkeydown = e => { if (e.key === 'Enter') openClient(c.id); };
      grid.appendChild(card);
    });
  }
  function toggleAddClient(s) { $('addClientForm').classList.toggle('hidden', !s); if (s) $('ncName').focus(); }
  async function saveNewClient() {
    const name = $('ncName').value.trim(); if (!name) { toast('Client name required'); return; }
    const fee = parseFloat($('ncFee').value);
    const people = $('ncPeople').value.split(',').map(s => s.trim()).filter(Boolean);
    const created = await apiSend('/api/growth/clients', 'POST', {
      name, business: $('ncBiz').value.trim(), currency: $('ncCur').value || '£',
      fee: isNaN(fee) ? null : fee, people,
    });
    if (!created) { toast('Could not add client'); return; }
    clients.push(created); dataCache[created.id] = fresh();
    ['ncName', 'ncBiz', 'ncFee', 'ncPeople'].forEach(i => $(i).value = ''); $('ncCur').value = '£';
    toggleAddClient(false); renderDash(); toast('Client added');
  }
  async function deleteClient() {
    const c = clients.find(x => x.id === cur); if (!c || !confirm(`Delete ${c.name} and all their data?`)) return;
    await apiSend('/api/growth/clients/' + cur, 'DELETE', {});
    clients = clients.filter(x => x.id !== cur); delete dataCache[cur]; cur = null;
    showDash(); toast('Client deleted');
  }
  function showDash() { $('clientView').classList.add('hidden'); $('reportSection').classList.add('hidden'); $('dashView').classList.remove('hidden'); renderDash(); }

  function cData() { return dataCache[cur]; }
  function cRec() { return clients.find(x => x.id === cur); }
  async function persist() { return !!(await apiSend('/api/growth/data/' + cur, 'PUT', cData())); }
  function openClient(id) {
    cur = id; curSym = cRec()?.currency || '£'; $('cName').textContent = cRec()?.name || ''; $('cBiz').textContent = cRec()?.business || 'Ads management';
    $('dashView').classList.add('hidden'); $('reportSection').classList.add('hidden'); $('clientView').classList.remove('hidden');
    $('moPicker').value = todayStr().slice(0, 7); switchTab('wig');
  }
  function switchTab(t) {
    ['wig', 'monthly', 'report'].forEach(x => { $('tab-' + x).classList.toggle('hidden', x !== t); $('tabBtn-' + x).classList.toggle('active', x === t); });
    if (t === 'wig') renderWig();
    if (t === 'monthly') { loadMonth(); renderMonthTable(); }
    if (t === 'report') { renderMonthlyTables(); renderRepMonthPicker(); }
  }

  function renderWig() {
    const d = cData(); if (!d) return; const b = d.board;
    $('wMetric').value = b?.metric || ''; $('wGoal').value = b?.goal ?? ''; $('wStart').value = b?.start || ''; $('wEnd').value = b?.end || '';
    const bc = boardCalc(d); const status = $('sbStatus'); const entry = $('sbEntry'); const stats = $('sbStats');
    if (bc) {
      entry.classList.remove('hidden');
      entry.innerHTML = `<div class="sb-entry">
        <label for="g-sbCurInput">Where we're up to</label>
        <input id="g-sbCurInput" type="number" min="0" step="any" value="${b.current ?? ''}" placeholder="0" onchange="Growth.saveCurrent(this.value)">
        <span class="se-metric">${esc(b.metric || '')} of ${b.goal}</span>
        <span class="se-hint">Update this in the weekly meeting</span></div>`;
      status.className = 'sb-status ' + (bc.winning == null ? 'idle' : (bc.winning ? 'win' : 'lose'));
      status.textContent = bc.winning == null ? 'Enter where you’re up to to see winning / losing' : (bc.winning ? 'WINNING' : 'LOSING');
      renderScoreBars(d, bc);
      const need = neededByNextMeeting(d); const op = openPeriod(d);
      stats.classList.remove('hidden');
      stats.innerHTML = `
        <div class="sb-stat"><div class="ss-lbl">By date</div><div class="ss-val">${niceDate(b.end)}</div></div>
        <div class="sb-stat"><div class="ss-lbl">WIG</div><div class="ss-val">${b.goal}</div></div>
        <div class="sb-stat"><div class="ss-lbl">Actual</div><div class="ss-val">${bc.current ?? '—'}</div></div>
        <div class="sb-stat"><div class="ss-lbl">Pacing</div><div class="ss-val">${Math.round(bc.pacing)}</div></div>
        <div class="sb-stat highlight"><div class="ss-lbl">Needed by ${op ? shortDate(op.end) : 'next meeting'}</div><div class="ss-val">${need != null ? need : '—'}</div></div>`;
    } else {
      entry.classList.add('hidden'); entry.innerHTML = '';
      status.className = 'sb-status idle'; status.textContent = 'No scoreboard yet — set the WIG below';
      $('sbBars').innerHTML = ''; $('sbMeta').innerHTML = '';
      stats.classList.add('hidden'); stats.innerHTML = '';
    }
    renderPeriods();
  }
  function renderScoreBars(d, bc) {
    const b = d.board; const cur2 = bc.current ?? 0, goal = b.goal, pace = bc.pacing; const max = Math.max(cur2, goal, pace, 1);
    const bar = (cls, l, v) => `<div class="sb-bar ${cls}"><div class="b-num">${Math.round(v * 10) / 10}</div><div class="b-fill" style="height:${Math.max(2, v / max * 140)}px"></div><div class="b-lbl">${l}</div></div>`;
    $('sbBars').innerHTML = bar('mtd', 'Actual', cur2) + bar('goal', 'WIG', goal) + bar('pace', 'Pacing', pace);
    const cp = commitPct(d);
    $('sbMeta').innerHTML = `
      <div class="sb-game">${esc(b.metric || 'Goal')}: ${goal} by ${niceDate(b.end)}</div>
      <div class="sb-line">Day ${bc.done} of ${bc.total}</div>
      <div class="sb-line">On pace you'd need <b>${Math.round(pace)}</b> by today — you have <b>${cur2}</b></div>
      <div style="margin-top:14px;"><div class="commit-pct">${cp != null ? Math.round(cp) + '%' : '—'}</div><div style="font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#7d766e;">Long-run commitment</div></div>`;
  }
  async function saveBoard() {
    const goal = parseFloat($('wGoal').value);
    const prevCurrent = cData().board?.current ?? null;
    cData().board = { metric: $('wMetric').value.trim(), goal: isNaN(goal) ? null : goal, start: $('wStart').value || null, end: $('wEnd').value || null, current: prevCurrent };
    await persist(); renderWig(); renderDash(); toast('WIG saved');
  }
  async function saveCurrent(val) {
    const v = parseFloat(val);
    if (!cData().board) return;
    cData().board.current = isNaN(v) ? null : v;
    await persist(); renderWig(); renderDash();
  }
  function ensureOpenPeriod() {
    const d = cData(); if (!d.periods) d.periods = [];
    if (d.periods.some(p => !p.locked)) return;
    const people = (cRec()?.people || []).map(n => ({ name: n, hot: '', later: '', renew: '', refer: '' }));
    const locked = d.periods.filter(p => p.locked).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    let start = todayStr();
    if (locked.length && locked[locked.length - 1].end) { const nd = new Date(locked[locked.length - 1].end + 'T00:00'); nd.setDate(nd.getDate() + 1); start = nd.toISOString().slice(0, 10); }
    const ed = new Date(start + 'T00:00'); ed.setDate(ed.getDate() + 6);
    d.periods.push({ id: 'p' + Date.now(), start, end: ed.toISOString().slice(0, 10), locked: false, goals: [], people });
  }
  function newGoalId() { return 'g' + Date.now() + Math.random().toString(36).slice(2, 6); }
  function renderPeriods() {
    ensureOpenPeriod(); const d = cData(); const host = $('periodsHost'); host.innerHTML = '';
    const open = d.periods.filter(p => !p.locked);
    const locked = d.periods.filter(p => p.locked).sort((a, b) => (b.end || '').localeCompare(a.end || ''));
    open.forEach(p => host.appendChild(periodCard(p, true)));
    if (locked.length) host.appendChild(periodCard(locked[0], false));
    if (locked.length > 1) {
      const more = document.createElement('details'); more.className = 'card';
      more.innerHTML = `<summary style="cursor:pointer; font-family:var(--g-serif); font-size:19px;">Earlier periods (${locked.length - 1})</summary>`;
      locked.slice(1).forEach(p => more.appendChild(periodCard(p, false))); host.appendChild(more);
    }
  }
  function periodCard(p, isOpen) {
    const wrap = document.createElement('div'); wrap.className = 'card period ' + (isOpen ? 'open' : ''); wrap.dataset.pid = p.id;
    const head = isOpen
      ? `<div class="period-head">
           <span class="ph-tag now">This period</span>
           <div class="ph-dates">
             <label class="ph-field"><span>Period start</span><input type="date" value="${p.start}" onchange="Growth.updPeriodDate('${p.id}','start',this.value)"></label>
             <span class="ph-arrow">→</span>
             <label class="ph-field"><span>Next meeting date</span><input type="date" value="${p.end}" onchange="Growth.updPeriodDate('${p.id}','end',this.value)"></label>
           </div></div>`
      : `<div class="period-head"><div class="ph-title">${shortDate(p.start)} → ${shortDate(p.end)}</div><span class="ph-tag past">Locked</span></div>`;
    let bodyHtml = (isOpen ? '' : snapshotBlock(p)) + goalsBlock(p, isOpen) + housekeepingBlock(p, isOpen) + '<div class="pb-people"></div>';
    if (isOpen) {
      bodyHtml += `<div class="period-actions">
        <button class="secondary" onclick="Growth.savePeriodProgress('${p.id}')">Save</button>
        <button class="accent" onclick="Growth.closePeriod('${p.id}')">Close period (after follow-up meeting)</button>
        <span class="muted" style="font-size:12.5px;">Save keeps this period open. Closing locks the goals in, snapshots the scoreboard, and starts a fresh period.</span>
      </div>`;
    }
    wrap.innerHTML = head + `<div class="period-body">${bodyHtml}</div>`;
    const peopleHost = wrap.querySelector('.pb-people');
    (p.people || []).forEach(pn => peopleHost.appendChild(personBlock(p, pn, isOpen)));
    return wrap;
  }
  // Frozen scoreboard numbers as they stood the moment this period was closed
  // (captured in closePeriod). The live scoreboard at the top of the tab keeps
  // moving with today's date and the latest Actual — this is what was true
  // at that specific follow-up meeting, for the history.
  function snapshotBlock(p) {
    const s = p.scoreboardSnapshot; if (!s) return '';
    const cls = s.winning == null ? 'idle' : (s.winning ? 'win' : 'lose');
    const label = s.winning == null ? 'NO SCOREBOARD AT CLOSE' : (s.winning ? 'WINNING' : 'LOSING');
    return `<div class="snapshot-block">
      <div class="snapshot-label">Scoreboard snapshot — at this meeting (${shortDate(s.capturedAt)})</div>
      <div class="sb-status ${cls}" style="font-size:16px; padding:8px; margin-bottom:12px;">${label}</div>
      <div class="sb-stats">
        <div class="sb-stat"><div class="ss-lbl">Metric</div><div class="ss-val" style="font-size:13px;">${esc(s.metric || '—')}</div></div>
        <div class="sb-stat"><div class="ss-lbl">WIG</div><div class="ss-val">${s.goal ?? '—'}</div></div>
        <div class="sb-stat"><div class="ss-lbl">Actual</div><div class="ss-val">${s.actual ?? '—'}</div></div>
        <div class="sb-stat"><div class="ss-lbl">Pacing</div><div class="ss-val">${s.pacing != null ? Math.round(s.pacing) : '—'}</div></div>
        <div class="sb-stat highlight"><div class="ss-lbl">Needed that week</div><div class="ss-val">${s.neededThisWeek ?? '—'}</div></div>
      </div>
    </div>`;
  }
  // Flat list of goals/WIGs for this period — not tied to a person. Any number
  // can be added; each is saved immediately so nothing is lost before the
  // period is closed.
  function goalsBlock(p, isOpen) {
    const goals = p.goals || [];
    const earned = goals.filter(g => g.done).length;
    const rows = goals.map(g => {
      const added = g.addedAt ? `<span class="goal-added">Added ${shortDate(g.addedAt)}</span>` : '';
      return isOpen
        ? `<div class="goal-row">
             <label class="chkbox"><input type="checkbox" ${g.done ? 'checked' : ''} onchange="Growth.toggleGoal('${p.id}','${g.id}',this.checked)"></label>
             <input class="goal-text" value="${esc(g.text)}" placeholder="e.g. Call all 6 hot leads" onchange="Growth.updateGoalText('${p.id}','${g.id}',this.value)">
             ${added}
             <button class="linkish" onclick="Growth.removeGoal('${p.id}','${g.id}')">remove</button>
           </div>`
        : `<div class="goal-row readonly"><span class="sdot ${g.done ? 'hit' : 'miss'}"></span><span class="goal-text-ro">${esc(g.text || '—')}</span>${added}</div>`;
    }).join('');
    const addRow = isOpen
      ? `<div class="goal-add-row">
           <input id="g-newGoal-${p.id}" placeholder="Add this week's commitment…" onkeydown="if(event.key==='Enter'){Growth.addGoal('${p.id}');event.preventDefault();}">
           <button class="secondary small" onclick="Growth.addGoal('${p.id}')">+ Add commitment</button>
         </div>`
      : '';
    const empty = !goals.length ? `<p class="muted" style="font-size:13px; margin:6px 0 10px;">${isOpen ? 'No commitments set yet — add one below.' : 'No commitments were set this period.'}</p>` : '';
    return `<div class="goals-block">
      <div class="pb-head" style="margin-bottom:8px;">
        <h4 style="font-size:17px;">This week's commitments</h4>
        <span class="muted" style="font-size:13px;">${goals.length ? `${earned} / ${goals.length} hit` : ''}</span>
      </div>
      ${empty}${rows}${addRow}
    </div>`;
  }
  async function addGoal(pid) {
    const p = cData().periods.find(x => x.id === pid); if (!p) return;
    const input = document.getElementById('g-newGoal-' + pid);
    const text = (input?.value || '').trim(); if (!text) return;
    if (!p.goals) p.goals = [];
    p.goals.push({ id: newGoalId(), text, done: false, addedAt: todayStr() });
    await persist(); renderWig();
  }
  async function toggleGoal(pid, gid, done) {
    const p = cData().periods.find(x => x.id === pid); const g = p?.goals?.find(x => x.id === gid); if (!g) return;
    g.done = !!done; await persist(); renderWig(); renderDash();
  }
  async function updateGoalText(pid, gid, text) {
    const p = cData().periods.find(x => x.id === pid); const g = p?.goals?.find(x => x.id === gid); if (!g) return;
    g.text = text.trim(); await persist();
  }
  async function removeGoal(pid, gid) {
    const p = cData().periods.find(x => x.id === pid); if (!p) return;
    p.goals = (p.goals || []).filter(x => x.id !== gid); await persist(); renderWig(); renderDash();
  }
  const HK_PRIORITY_COLOR = { High: '#c0392b', Medium: '#cd5f39', Low: '#7a8f6b' };
  // Housekeeping list for one period — real tasks (openTaskModal handles
  // create/edit/status/assignee/due-date identically to My Tasks or a
  // client's own profile), just filtered to this client + this period.
  function housekeepingBlock(p, isOpen) {
    const tasks = housekeepingTasks.filter(t => t.growthClientId === cur && t.growthPeriodId === p.id && !t.archived);
    const rows = tasks.map(t => {
      const color = HK_PRIORITY_COLOR[t.priority] || '#8A7A6E';
      const who = (t.assignedTo || []).join(', ') || 'Unassigned';
      const due = t.deadline ? shortDate(t.deadline) : 'No due date';
      return `<div class="hk-row" onclick="openTaskModal('${t.id}')">
        <span class="hk-stripe" style="background:${color}"></span>
        <span class="hk-title">${esc(t.title)}</span>
        <span class="hk-meta">${esc(who)} &middot; ${esc(t.status)} &middot; ${esc(due)}</span>
      </div>`;
    }).join('');
    const empty = !tasks.length ? `<p class="muted" style="font-size:13px; margin:6px 0 10px;">${isOpen ? 'No housekeeping tasks yet — add one below.' : 'No housekeeping tasks this period.'}</p>` : '';
    const addRow = isOpen ? `<button class="secondary small" onclick="Growth.addHousekeepingTask('${p.id}')">+ Add housekeeping task</button>` : '';
    return `<div class="housekeeping-block">
      <div class="pb-head" style="margin-bottom:8px;">
        <h4 style="font-size:17px;">Housekeeping</h4>
        <span class="muted" style="font-size:13px;">${tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      ${empty}${rows}${addRow}
    </div>`;
  }
  // Opens the app's own shared task modal (My Tasks / client-profile tasks
  // all use it too) pre-linked to this client and period — this file never
  // builds its own task-editing UI, it just points the real one at itself.
  function addHousekeepingTask(pid) {
    if (typeof openTaskModal !== 'function') { toast('Task tool not available'); return; }
    openTaskModal(null, null, { growthClientId: cur, growthPeriodId: pid });
  }
  // Called by app.js's closeTaskModal() after any create/edit/delete/
  // archive — keeps the open period's Housekeeping list current without
  // this file and app.js needing to know anything else about each other.
  async function refreshHousekeeping() {
    if (!cur) return;
    await loadHousekeeping();
    const wigTab = document.getElementById('g-tab-wig');
    if (wigTab && !wigTab.classList.contains('hidden')) renderPeriods();
  }
  function personBlock(period, pn, isOpen) {
    const div = document.createElement('div'); div.className = 'person-block'; div.dataset.name = pn.name;
    const headRight = isOpen ? `<button class="linkish" onclick="Growth.removePerson('${period.id}','${esc(pn.name)}')">remove</button>` : '';
    const head = `<div class="pb-head"><div class="pb-name-wrap"><h4>${esc(pn.name)}</h4></div>${headRight}</div>`;
    if (!isOpen) {
      const hasNotes = pn.hot || pn.later || pn.renew || pn.refer;
      if (!hasNotes) { div.innerHTML = ''; div.style.display = 'none'; return div; }
      div.innerHTML = head + `<div class="leadgrid" style="font-size:13px;">
          ${pn.hot ? `<div><label>Hot leads</label><div class="computed">${esc(pn.hot)}</div></div>` : ''}
          ${pn.later ? `<div><label>Later</label><div class="computed">${esc(pn.later)}</div></div>` : ''}
          ${pn.renew ? `<div><label>Renewals</label><div class="computed">${esc(pn.renew)}</div></div>` : ''}
          ${pn.refer ? `<div><label>Referrals</label><div class="computed">${esc(pn.refer)}</div></div>` : ''}
        </div>`;
      return div;
    }
    div.innerHTML = head + `
      <details class="coach">
        <summary>Lead inventory &amp; coaching notes</summary>
        <div class="coach-inner"><div class="leadgrid">
          <div><label>Hot leads — ≥50% this period</label><textarea class="pc-hot" rows="2">${esc(pn.hot || '')}</textarea></div>
          <div><label>Later — good, not now (say when)</label><textarea class="pc-later" rows="2">${esc(pn.later || '')}</textarea></div>
          <div><label>Renewals / retests</label><textarea class="pc-renew" rows="2">${esc(pn.renew || '')}</textarea></div>
          <div><label>Referrals</label><textarea class="pc-refer" rows="2">${esc(pn.refer || '')}</textarea></div>
        </div></div>
      </details>`;
    return div;
  }
  async function updPeriodDate(pid, f, v) { const p = cData().periods.find(x => x.id === pid); if (p) { p[f] = v; await persist(); renderWig(); } }
  function collectOpenPeriod(pid) {
    const wrap = document.querySelector(`#tab-growth .period[data-pid="${pid}"]`); if (!wrap) return null;
    const people = []; const val = (b, s) => { const el = b.querySelector(s); return el ? el.value : ''; };
    wrap.querySelectorAll('.person-block').forEach(b => people.push({
      name: b.dataset.name, hot: val(b, '.pc-hot'), later: val(b, '.pc-later'),
      renew: val(b, '.pc-renew'), refer: val(b, '.pc-refer'),
    }));
    return people;
  }
  // "Save" keeps the period open — for jotting progress mid-week. Goals
  // themselves already auto-save on every add/tick/edit; this also captures
  // the coaching-notes fields, which don't.
  async function savePeriodProgress(pid) {
    const d = cData(), p = d.periods.find(x => x.id === pid); if (!p) return;
    const people = collectOpenPeriod(pid); if (people) p.people = people;
    const ok = await persist();
    toast(ok ? 'Saved' : 'Save failed');
  }
  // "Close period" is the after-follow-up-meeting action — locks the goals in
  // permanently, freezes a snapshot of the scoreboard as it stood at this
  // meeting, and opens a fresh period.
  async function closePeriod(pid) {
    const d = cData(), p = d.periods.find(x => x.id === pid); if (!p) return;
    if (!confirm('Close this period? Goals will lock in and a fresh period will open.')) return;
    const people = collectOpenPeriod(pid); if (people) p.people = people;
    const bc = boardCalc(d);
    if (bc) {
      p.scoreboardSnapshot = {
        metric: d.board?.metric || '',
        goal: d.board?.goal ?? null,
        boardEnd: d.board?.end || null,
        actual: bc.current ?? null,
        pacing: bc.pacing,
        winning: bc.winning,
        neededThisWeek: neededByNextMeeting(d), // computed before ensureOpenPeriod() re-points "open period"
        capturedAt: todayStr(),
      };
    }
    p.locked = true; ensureOpenPeriod();
    const ok = await persist(); renderWig(); renderDash();
    toast(ok ? 'Period closed — new period opened' : 'Save failed');
    document.getElementById('tab-growth')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function addPerson() {
    const n = $('newPerson').value.trim(); if (!n) return;
    const r = cRec(); r.people = r.people || []; if (!r.people.includes(n)) r.people.push(n);
    const open = cData().periods.find(p => !p.locked);
    if (open && !open.people.some(x => x.name === n)) open.people.push({ name: n, hot: '', later: '', renew: '', refer: '', commit: '', commitDone: false, wig: '', wigDone: false });
    await apiSend('/api/growth/clients/' + cur, 'PUT', { people: r.people });
    await persist(); $('newPerson').value = ''; renderWig(); toast('Person added');
  }
  async function removePerson(pid, name) { const o = cData().periods.find(p => p.id === pid); if (!o) return; o.people = o.people.filter(x => x.name !== name); await persist(); renderWig(); }

  // Working copy of the campaigns for whichever month is loaded in the
  // data-entry form — a deep clone, so nothing touches the real data until
  // "Save month" is clicked (same rule the old single-campaign form had).
  let workingCampaigns = [];
  function blankCampaign() { return { name: '', ads: {}, pipe: {} }; }
  function loadMonth() {
    const mo = $('moPicker').value; if (!mo) { $('monthForm').classList.add('hidden'); return; }
    const existing = campaignsFor(cData(), mo);
    workingCampaigns = existing.length ? JSON.parse(JSON.stringify(existing)) : [blankCampaign()];
    renderCampaignRows();
    $('monthForm').classList.remove('hidden');
  }
  function renderCampaignRows() {
    $('campaignsHost').innerHTML = workingCampaigns.map((c, i) => campaignRowHtml(c, i)).join('');
    workingCampaigns.forEach((c, i) => recalcCampaignRow(i)); // populate computed cells for any values already saved
  }
  function campaignRowHtml(c, idx) {
    const a = c.ads || {}, p = c.pipe || {};
    const field = (label, path, val) => `<div><label>${label}</label><input type="number" step="any" class="camp-f" value="${val ?? ''}" oninput="Growth.updateCampaignField(${idx},'${path}',this.value)"></div>`;
    const computed = (label, cls) => `<div><label>${label}</label><div class="computed ${cls}">&mdash;</div></div>`;
    return `<div class="campaign-row" data-idx="${idx}">
      <div class="campaign-row-head">
        <input type="text" class="camp-name" placeholder="Ad / campaign name" value="${esc(c.name || '')}" oninput="Growth.updateCampaignField(${idx},'name',this.value)">
        ${workingCampaigns.length > 1 ? `<button class="linkish" onclick="Growth.removeCampaignRow(${idx})">remove</button>` : ''}
      </div>
      <h3>Ad account</h3>
      <div class="metric-grid" style="margin-bottom:14px;">
        ${field('Ad spend ($)', 'ads.spend', a.spend)}
        ${field('Impressions', 'ads.impr', a.impr)}
        ${field('Link clicks', 'ads.clicks', a.clicks)}
        ${field('Leads (opt-ins)', 'ads.leads', a.leads)}
        ${computed('CPM', 'camp-cpm')}
        ${computed('CTR', 'camp-ctr')}
        ${computed('Opt-in rate', 'camp-opt')}
        ${computed('CPL', 'camp-cpl')}
      </div>
      <h3>Pipeline (GHL)</h3>
      <div class="metric-grid">
        ${field('Booked', 'pipe.booked', p.booked)}
        ${field('Showed', 'pipe.showed', p.showed)}
        ${field('Closed', 'pipe.closed', p.closed)}
        ${field('New revenue ($)', 'pipe.rev', p.rev)}
        ${computed('Book %', 'camp-book')}
        ${computed('Show %', 'camp-show')}
        ${computed('Close %', 'camp-close')}
      </div>
    </div>`;
  }
  // Fired on every keystroke — keeps workingCampaigns in sync (so adding or
  // removing a row never loses what's already typed elsewhere) and updates
  // just that row's live computed rates without a full re-render.
  function updateCampaignField(idx, path, value) {
    const c = workingCampaigns[idx]; if (!c) return;
    if (path === 'name') { c.name = value; return; }
    const [group, field] = path.split('.');
    if (!c[group]) c[group] = {};
    const v = parseFloat(value);
    c[group][field] = isNaN(v) ? null : v;
    recalcCampaignRow(idx);
  }
  function recalcCampaignRow(idx) {
    const c = workingCampaigns[idx]; if (!c) return;
    const row = document.querySelector(`#g-campaignsHost .campaign-row[data-idx="${idx}"]`); if (!row) return;
    const a = c.ads || {}, p = c.pipe || {};
    const set = (cls, v) => { const e = row.querySelector('.' + cls); if (e) { e.textContent = v; e.classList.toggle('on', v !== '—'); } };
    set('camp-cpm',  (a.spend != null && a.impr) ? fmt$(a.spend / a.impr * 1000) : '—');
    set('camp-ctr',  (a.clicks != null && a.impr) ? fmtP(a.clicks / a.impr * 100) : '—');
    set('camp-opt',  (a.leads != null && a.clicks) ? fmtP(a.leads / a.clicks * 100) : '—');
    set('camp-cpl',  (a.spend != null && a.leads) ? fmt$(a.spend / a.leads) : '—');
    set('camp-book', (p.booked != null && a.leads) ? fmtP(p.booked / a.leads * 100) : '—');
    set('camp-show', (p.showed != null && p.booked) ? fmtP(p.showed / p.booked * 100) : '—');
    set('camp-close',(p.closed != null && p.showed) ? fmtP(p.closed / p.showed * 100) : '—');
  }
  function addCampaignRow() { workingCampaigns.push(blankCampaign()); renderCampaignRows(); }
  function removeCampaignRow(idx) {
    workingCampaigns.splice(idx, 1);
    if (!workingCampaigns.length) workingCampaigns.push(blankCampaign());
    renderCampaignRows();
  }
  async function saveMonth() {
    const mo = $('moPicker').value; if (!mo) { toast('Pick the month'); return; }
    if (!cData().months) cData().months = {};
    // Drop rows nobody filled in (a spare "+ Add another campaign" left
    // blank) so they don't get saved as ghost zero-value campaigns.
    const campaigns = workingCampaigns
      .filter(c => (c.name && c.name.trim()) || Object.values(c.ads || {}).some(v => v != null) || Object.values(c.pipe || {}).some(v => v != null))
      .map((c, i) => ({ id: c.id || ('camp_' + Date.now() + '_' + i), name: (c.name || '').trim() || `Campaign ${i + 1}`, ads: c.ads || {}, pipe: c.pipe || {} }));
    cData().months[mo] = { campaigns };
    const ok = await persist(); toast(ok ? 'Month saved' : 'Save failed'); renderMonthTable(); renderDash();
  }
  function renderMonthTable() {
    const tb = $('monthTable').querySelector('tbody'); tb.innerHTML = ''; const d = cData();
    monthKeys(d).slice().reverse().forEach(mo => {
      const r = monthRaw(d, mo); const cpl = (r.spend && r.leads) ? r.spend / r.leads : null;
      const n = campaignsFor(d, mo).length;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${monthLabel(mo)}${n > 1 ? ` <span class="muted" style="font-size:11px">(${n} campaigns)</span>` : ''}</td><td>${fmt$(r.spend || null)}</td><td>${fmtN(r.leads || null)}</td><td>${fmt$(cpl)}</td><td>${fmtN(r.booked || null)}</td><td>${fmtN(r.showed || null)}</td><td>${fmtN(r.closed || null)}</td><td>${fmt$(r.rev || null)}</td><td><button class="linkish" onclick="Growth.editMonth('${mo}')">edit</button> <button class="linkish" onclick="Growth.delMonth('${mo}')">delete</button></td>`;
      tb.appendChild(tr);
    });
  }
  function editMonth(mo) { $('moPicker').value = mo; loadMonth(); document.getElementById('tab-growth')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  async function delMonth(mo) { if (!confirm('Delete data for ' + monthLabel(mo) + '?')) return; delete cData().months[mo]; await persist(); renderMonthTable(); renderDash(); }
  // Lets the Monthly Report table itself double as an edit surface for a
  // specific campaign's raw figures — the computed rates (CPM, CTR, CAC,
  // ROAS, ROI, etc.) are never editable since they're always derived, never
  // entered directly.
  async function setCampaignField(mo, campId, group, field, val) {
    const d = cData(); if (!d.months) d.months = {};
    if (!d.months[mo]) d.months[mo] = { campaigns: [] };
    const camp = d.months[mo].campaigns.find(c => c.id === campId);
    if (!camp) return;
    if (!camp[group]) camp[group] = {};
    const v = parseFloat(val);
    camp[group][field] = isNaN(v) ? null : v;
    await persist(); renderMonthlyTables(); renderDash();
  }
  // A campaign's own rates, computed straight from its own numbers (fee is
  // a monthly retainer, never split per campaign, so it plays no part here
  // — only the month-total and grand-total columns ever show ROI).
  function campaignRates(c) { return deriveRates(campaignRaw(c), 0); }

  function renderMonthlyTables() {
    const d = cData(), mosAsc = monthKeys(d), host = $('monthlyTables');
    if (!mosAsc.length) { host.innerHTML = '<div class="card"><p class="muted">This table builds itself once monthly data is entered.</p></div>'; return; }
    const cols = mosAsc.slice().reverse();
    const tot = totalAgg(d);
    const aggByMo = {}; const campsByMo = {};
    cols.forEach(mo => { aggByMo[mo] = monthAgg(d, mo); campsByMo[mo] = campaignsFor(d, mo); });
    const sym = cRec()?.currency || '£';
    const rc = v => v == null ? '' : (v >= 1.5 ? 'roi-cell-good' : v >= 1 ? 'roi-cell-warn' : 'roi-cell-bad');

    // Two header rows: month names spanning their campaign columns (plus
    // one "Total" sub-column each), then the campaign names themselves.
    const head = `<tr><th rowspan="2"></th><th rowspan="2">Total</th>${cols.map(mo => `<th colspan="${Math.max(campsByMo[mo].length, 1) + 1}">${monthLabel(mo)}</th>`).join('')}</tr>` +
      `<tr>${cols.map(mo => {
        const camps = campsByMo[mo];
        const names = camps.length ? camps.map(c => esc(c.name)) : ['—'];
        return names.map(n => `<th class="camp-subhead">${n}</th>`).join('') + '<th class="camp-subhead">Total</th>';
      }).join('')}</tr>`;

    // Calculated rows (CPM, CTR, CAC, ROAS, etc.) — never editable, always
    // derived. Per-campaign cells use that campaign's own numbers; the
    // month sub-total cell uses the month's combined numbers.
    const calcRow = (label, key, fmtFn, cls) => {
      const cells = cols.map(mo => {
        const camps = campsByMo[mo];
        const perCamp = camps.length ? camps.map(c => `<td class="${cls || ''}">${fmtFn(campaignRates(c)[key])}</td>`).join('') : `<td class="${cls || ''} muted-cell">${fmtFn(null)}</td>`;
        return perCamp + `<td class="camp-total ${cls || ''}">${fmtFn(aggByMo[mo][key])}</td>`;
      }).join('');
      return `<tr><td>${label}</td><td class="${cls || ''}">${fmtFn(tot[key])}</td>${cells}</tr>`;
    };
    // Raw, manually-entered rows — one editable cell per campaign, plus a
    // computed (read-only) month sub-total and grand total.
    const rawRow = (label, group, field, fmtFn) => {
      const cells = cols.map(mo => {
        const camps = campsByMo[mo];
        if (!camps.length) return `<td class="muted-cell">${fmtFn(null)}</td><td class="camp-total">${fmtFn(null)}</td>`;
        const perCamp = camps.map(c => `<td><input class="fee-in" type="number" step="any" value="${c[group]?.[field] ?? ''}" onchange="Growth.setCampaignField('${mo}','${c.id}','${group}','${field}',this.value)"></td>`).join('');
        const sum = camps.reduce((s, c) => s + (c[group]?.[field] || 0), 0);
        const hasAny = camps.some(c => c[group]?.[field] != null);
        return perCamp + `<td class="camp-total">${fmtFn(hasAny ? sum : null)}</td>`;
      }).join('');
      return `<tr><td>${label}</td><td>${fmtFn(tot[field] || null)}</td>${cells}</tr>`;
    };
    // ROI needs the monthly fee, which isn't split per campaign — so it's
    // shown only at the month-total and grand-total level.
    const roiRow = () => {
      const cells = cols.map(mo => {
        const n = Math.max(campsByMo[mo].length, 1);
        return Array(n).fill('<td class="muted-cell">—</td>').join('') + `<td class="camp-total ${rc(aggByMo[mo].roi)}">${fmt2(aggByMo[mo].roi)}</td>`;
      }).join('');
      return `<tr><td>ROI</td><td class="${rc(tot.roi)}">${fmt2(tot.roi)}</td>${cells}</tr>`;
    };
    const spacer = () => `<tr class="tspace"><td colspan="${2 + cols.reduce((s, mo) => s + Math.max(campsByMo[mo].length, 1) + 1, 0)}"></td></tr>`;

    // Fee is a monthly retainer, not per campaign — one input spanning the
    // whole month's column group rather than duplicated per campaign.
    let feeTotal = 0; cols.forEach(mo => feeTotal += feeFor(d, mo));
    const feeRow = `<tr><td>Our fee</td><td>${money(feeTotal, sym)}</td>` +
      cols.map(mo => `<td colspan="${Math.max(campsByMo[mo].length, 1) + 1}"><input class="fee-in" type="number" min="0" step="0.01" value="${d.fees[mo] ?? ''}" placeholder="${cRec()?.fee ?? ''}" onchange="Growth.setFee('${mo}',this.value)"></td>`).join('') + '</tr>';

    const body =
      feeRow + spacer() +
      rawRow('Ad spend', 'ads', 'spend', a => money(a, sym)) +
      calcRow('CPM', 'cpm', a => money(a, sym)) +
      rawRow('Impressions', 'ads', 'impr', a => fmtN(a)) +
      calcRow('Link CTR', 'ctr', a => fmtP2(a)) +
      rawRow('Clicks', 'ads', 'clicks', a => fmtN(a)) +
      calcRow('Opt in %', 'optin', a => fmtP2(a)) +
      rawRow('Leads', 'ads', 'leads', a => fmtN(a)) +
      calcRow('Booking %', 'bookPct', a => fmtP0(a)) +
      rawRow('Bookings', 'pipe', 'booked', a => fmtN(a)) +
      calcRow('Show rate %', 'showPct', a => fmtP0(a)) +
      rawRow('Shows', 'pipe', 'showed', a => fmtN(a)) +
      calcRow('Close rate %', 'closePct', a => fmtP0(a)) +
      rawRow('Sales Made', 'pipe', 'closed', a => fmtN(a)) +
      spacer() +
      calcRow('CAC', 'cac', a => money(a, sym)) +
      rawRow('Total New Revenue', 'pipe', 'rev', a => money(a, sym)) +
      spacer() +
      calcRow('ROAS', 'roas', a => fmt2(a)) +
      roiRow();

    host.innerHTML = `
      <div class="card">
        <div class="mreport-head">
          <h2>Monthly performance</h2>
          <label class="cur-pick">Amounts in
            <select onchange="Growth.setClientCurrency(this.value)">
              ${['£', '$', 'A$', '€'].map(s => `<option value="${s}" ${s === sym ? 'selected' : ''}>${s === '£' ? '£ GBP' : s === '$' ? '$ USD' : s === 'A$' ? 'A$ AUD' : '€ EUR'}</option>`).join('')}
            </select></label>
        </div>
        <div class="mreport-scroll">
          <table class="mreport">
            <thead>${head}</thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <p class="muted" style="font-size:12px; margin-top:12px;">CAC = ad spend ÷ sales made. ROAS = revenue ÷ ad spend. ROI = revenue ÷ (ad spend + fee). Total column is computed from summed totals, not averaged. Enter 0 fee for a comped month.</p>
      </div>`;
  }
  async function setClientCurrency(sym) { const c = cRec(); if (!c) return; c.currency = sym; curSym = sym; await apiSend('/api/growth/clients/' + cur, 'PUT', { currency: sym }); renderMonthlyTables(); renderDash(); }
  async function setFee(mo, val) { const v = parseFloat(val); if (isNaN(v)) delete cData().fees[mo]; else cData().fees[mo] = v; await persist(); renderMonthlyTables(); renderDash(); }
  function renderRepMonthPicker() {
    const sel = $('repMonth'), mos = monthKeys(cData());
    sel.innerHTML = mos.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    if (mos.length) sel.value = mos[mos.length - 1]; sel.onchange = loadMonthNotes; loadMonthNotes();
  }
  function loadMonthNotes() { const n = cData().notes[$('repMonth').value] || {}; $('repDid').value = n.did || ''; $('repNext').value = n.next || ''; }
  async function saveMonthNotes() { const mo = $('repMonth').value; if (!mo) return; cData().notes[mo] = { did: $('repDid').value, next: $('repNext').value }; await persist(); toast('Notes saved'); }

  function backToClient() { $('reportSection').classList.add('hidden'); $('clientView').classList.remove('hidden'); }
  function sparkline(vals) {
    const W = 220, H = 80, pad = 6; const clean = vals.filter(v => v != null);
    if (clean.length < 2) return '<svg viewBox="0 0 220 80"><text x="8" y="44" font-size="11" fill="#7d766e">Not enough data yet</text></svg>';
    const min = Math.min(...clean), max = Math.max(...clean), rng = (max - min) || 1; const step = (W - pad * 2) / (vals.length - 1);
    let path = '', dots = '';
    vals.forEach((v, i) => { if (v == null) return; const x = pad + i * step, y = H - pad - ((v - min) / rng) * (H - pad * 2); path += (path ? 'L' : 'M') + x + ' ' + y + ' '; const last = i === vals.length - 1; dots += `<circle cx="${x}" cy="${y}" r="${last ? 4 : 2.5}" fill="${last ? '#cd5f39' : '#c7baa6'}"/>`; });
    return `<svg viewBox="0 0 ${W} ${H}" role="img"><path d="${path}" fill="none" stroke="#cd5f39" stroke-width="2"/>${dots}</svg>`;
  }
  function showReport() {
    const mo = $('repMonth').value; if (!mo) { toast('No monthly data'); return; }
    const d = cData(), c = cRec(), a = monthAgg(d, mo);
    const mos = monthKeys(d), idx = mos.indexOf(mo), prevMo = mos[idx - 1] || null, pa = prevMo ? monthAgg(d, prevMo) : null;
    const notes = d.notes[mo] || {};
    const delta = (cv, pv, inv = false) => { if (cv == null || pv == null || pv === 0) return ''; const ch = (cv - pv) / Math.abs(pv) * 100; const good = inv ? ch < 0 : ch > 0; return `<div class="k-delta ${good ? 'delta-up' : 'delta-down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch))}% vs ${monthLabel(prevMo)}</div>`; };

    let boardHtml = ''; const bc = boardCalc(d);
    if (bc && bc.current != null) {
      const max = Math.max(bc.current, d.board.goal, bc.pacing, 1);
      const bar = (cls, l, v) => `<div class="sb-bar ${cls}"><div class="b-num">${Math.round(v * 10) / 10}</div><div class="b-fill" style="height:${Math.max(2, v / max * 120)}px"></div><div class="b-lbl">${l}</div></div>`;
      boardHtml = `<div class="sb-status ${bc.winning ? 'win' : 'lose'}" style="margin-bottom:14px;">${bc.winning ? 'WINNING' : 'LOSING'}</div>
        <div style="font-family:var(--g-serif); font-size:19px; margin-bottom:10px;">${esc(d.board.metric || 'Goal')}: ${d.board.goal} by ${niceDate(d.board.end)}</div>
        <div class="sb-bars" style="max-width:420px; height:160px; margin-bottom:28px;">${bar('mtd', 'Actual', bc.current)}${bar('goal', 'WIG', d.board.goal)}${bar('pace', 'Pacing', bc.pacing)}</div>`;
    }
    const shades = ['#8a7f6e', '#a5674b', '#b95c3f', '#cd5f39'];
    const stages = [{ n: a.leads, l: 'Leads' }, { n: a.booked, l: 'Booked' }, { n: a.showed, l: 'Showed' }, { n: a.closed, l: 'Closed' }];
    const convs = [a.bookPct, a.showPct, a.closePct];
    let funnel = '<div class="funnel"><div class="funnel-track">';
    stages.forEach((st, i) => { funnel += `<div class="f-stage" style="flex:${4 - i * 0.7} 1 0; background:${shades[i]};"><div class="f-num">${fmtN(st.n || null)}</div><div class="f-lbl">${st.l}</div></div>`; if (i < 3) funnel += `<div class="f-conv"><strong>${fmtP(convs[i])}</strong>convert</div>`; });
    funnel += '</div></div>';
    const kpis = [
      { l: 'Ad spend', v: fmt$(a.spend || null), d: delta(a.spend, pa?.spend, true) },
      { l: 'CPL', v: fmt$(a.cpl), d: delta(a.cpl, pa?.cpl, true) },
      { l: 'New revenue', v: fmt$(a.rev || null), d: delta(a.rev, pa?.rev) },
      { l: 'CAC', v: fmt$(a.cac), d: delta(a.cac, pa?.cac, true) },
      { l: 'ROAS', v: fmtX(a.roas), d: delta(a.roas, pa?.roas) },
      { l: 'ROI', v: fmtX(a.roi), d: delta(a.roi, pa?.roi) },
    ].filter(k => k.v !== '—');
    const trendMos = mos.slice(-6);
    const series = [{ l: 'Cost per lead', get: m => monthAgg(d, m).cpl, inv: true }, { l: 'New revenue', get: m => { const x = monthAgg(d, m); return x.rev || null; } }, { l: 'ROI', get: m => monthAgg(d, m).roi }];
    const trendHtml = `<div class="report-trend"><h3>The trend</h3><div class="rt-row">${series.map(s => `<div class="rt-box"><h5>${s.l}</h5>${sparkline(trendMos.map(s.get))}</div>`).join('')}</div></div>`;

    const monthPeriods = (d.periods || []).filter(p => p.locked && monthOf(p.end || '') === mo);
    let acct = '';
    if (monthPeriods.length && monthPeriods.some(p => (p.goals || []).length)) {
      let totE = 0, totP = 0, rows = '';
      monthPeriods.slice().sort((a, b) => (a.end || '').localeCompare(b.end || '')).forEach(p => {
        (p.goals || []).forEach(g => {
          totP++; if (g.done) totE++;
          rows += `<div style="display:grid; grid-template-columns:120px 1fr; gap:10px; font-size:13px; align-items:center; border-bottom:1px solid var(--g-lightgrey); padding:7px 0;">
            <div style="font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#7d766e;">${shortDate(p.start)}–${shortDate(p.end)}</div>
            <div><span class="sdot ${g.done ? 'hit' : 'miss'}" style="display:inline-block; margin-right:6px; vertical-align:middle;"></span>${esc(g.text || '—')}</div></div>`;
        });
      });
      const pct = totP ? totE / totP * 100 : 0;
      const verdict = pct >= 80 ? 'Scoreboard held — the system works when both sides play.' : pct >= 50 ? 'Partial scoreboard — results track with the goals missed.' : 'Scoreboard mostly missed — ad results only convert when the weekly goals get done.';
      acct = `<div style="border-top:3px solid var(--g-charcoal); padding-top:16px; margin-top:6px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px;">
          <h3 style="font-size:21px;">The scoreboard — your side of the system</h3>
          <div style="font-family:var(--g-serif); font-size:26px;"><span style="color:var(--g-orange);">${totE}</span> / ${totP} goals</div></div>
        ${rows}<p style="font-size:13.5px; margin-top:12px; color:#57524c;">${verdict}</p></div>`;
    }

    let html = `
      <div class="report-masthead"><div><div class="wm">GATHR <span>GROW</span></div><div class="sub">Monthly Performance Report</div></div>
        <div class="report-for"><div class="c-name">${esc(c.name)}</div><div class="c-month">${monthLabel(mo)}</div></div></div>
      ${boardHtml}${funnel}
      <div class="kpi-grid">${kpis.map(k => `<div class="kpi"><div class="k-lbl">${k.l}</div><div class="k-val">${k.v}</div>${k.d}</div>`).join('')}</div>
      ${trendHtml}${acct}`;
    if (notes.did) html += `<div class="report-notes"><h3>What's working well</h3><p>${esc(notes.did)}</p></div>`;
    if (notes.next) html += `<div class="report-notes"><h3>What we're changing next month</h3><p>${esc(notes.next)}</p></div>`;
    html += `<div class="report-footer"><div>Prepared by Gathr Grow · gathrspace.com.au</div><div>309 George Street, Sydney CBD</div></div>`;
    $('reportInner').innerHTML = html;
    $('clientView').classList.add('hidden'); $('reportSection').classList.remove('hidden');
    document.getElementById('tab-growth')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  window.Growth = {
    onOpen, toggleAddClient, saveNewClient, deleteClient, showDash, openClient, switchTab,
    saveBoard, saveCurrent, addPerson, updPeriodDate, savePeriodProgress, closePeriod, removePerson,
    addGoal, toggleGoal, updateGoalText, removeGoal,
    addHousekeepingTask, refreshHousekeeping,
    loadMonth, saveMonth, editMonth, delMonth, setFee, setClientCurrency,
    addCampaignRow, removeCampaignRow, updateCampaignField, setCampaignField,
    showReport, saveMonthNotes, backToClient,
  };
})();
