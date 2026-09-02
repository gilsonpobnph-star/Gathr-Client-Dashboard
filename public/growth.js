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
  function fresh() { return { board: null, periods: [], weeks: {}, fees: {}, notes: {} }; }

  let booted = false;
  async function onOpen() {
    setSync('Loading…');
    clients = (await apiGet('/api/growth/clients')) || [];
    await Promise.all(clients.map(async c => {
      dataCache[c.id] = (await apiGet('/api/growth/data/' + c.id)) || fresh();
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
  function lastFriday() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7)); return d.toISOString().slice(0, 10); }
  function niceDate(s) { return s ? new Date(s + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long' }) : ''; }
  function shortDate(s) { return s ? new Date(s + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''; }
  function monthOf(s) { return s.slice(0, 7); }
  function monthLabel(mo) { const [y, m] = mo.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y; }

  function weekKeys(d) { return Object.keys(d.weeks).sort(); }
  function monthKeys(d) { return [...new Set(weekKeys(d).map(monthOf))].sort(); }
  function sumWeeks(d, f) {
    const s = { spend: 0, impr: 0, clicks: 0, leads: 0, booked: 0, showed: 0, closed: 0, rev: 0, any: false };
    weekKeys(d).filter(f).forEach(k => {
      const w = d.weeks[k];
      if (w.ads) ['spend', 'impr', 'clicks', 'leads'].forEach(x => { if (w.ads[x] != null) { s[x] += w.ads[x]; s.any = true; } });
      if (w.pipe) ['booked', 'showed', 'closed', 'rev'].forEach(x => { if (w.pipe[x] != null) { s[x] += w.pipe[x]; s.any = true; } });
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
  function monthAgg(d, mo) { return deriveRates(sumWeeks(d, k => monthOf(k) === mo), feeFor(d, mo)); }
  function totalAgg(d) { const mos = monthKeys(d); let fees = 0; mos.forEach(mo => { fees += feeFor(d, mo); }); return deriveRates(sumWeeks(d, () => true), fees); }
  function longRun(d) {
    const s = sumWeeks(d, () => true); const mos = monthKeys(d);
    let fees = 0; mos.forEach(mo => { fees += feeFor(d, mo); });
    const inv = s.spend + fees;
    return { roas: s.spend ? s.rev / s.spend : null, roi: inv ? s.rev / inv : null, cac: s.closed ? s.spend / s.closed : null, any: s.any };
  }
  function boardCurrent(d) { const b = d.board; if (!b) return null; return (b.current != null && !isNaN(b.current)) ? Number(b.current) : null; }
  function boardCalc(d) {
    const b = d.board; if (!b || !b.goal || !b.start || !b.end) return null;
    const total = Math.max(1, daysBetween(b.start, b.end)); const t = todayStr();
    const ref = t > b.end ? b.end : (t < b.start ? b.start : t); const done = Math.max(0, daysBetween(b.start, ref));
    const pacing = b.goal * done / total; const current = boardCurrent(d);
    return { total, done, pacing, current, winning: current != null ? current >= pacing : null };
  }
  function boardPacingAtDate(d, dateStr) {
    const b = d.board; if (!b || !b.goal || !b.start || !b.end) return 0;
    const total = Math.max(1, daysBetween(b.start, b.end)); const dd = Math.min(Math.max(0, daysBetween(b.start, dateStr)), total);
    return b.goal * dd / total;
  }
  function commitPct(d) {
    let e = 0, p = 0; (d.periods || []).filter(pd => pd.locked).forEach(pd => pd.people.forEach(pn => { p += 2; e += (pn.wigDone ? 1 : 0) + (pn.commitDone ? 1 : 0); }));
    return p ? e / p * 100 : null;
  }
  function commitPctPerson(d, name) {
    let e = 0, p = 0; (d.periods || []).filter(pd => pd.locked).forEach(pd => { const pn = pd.people.find(x => x.name === name); if (pn) { p += 2; e += (pn.wigDone ? 1 : 0) + (pn.commitDone ? 1 : 0); } });
    return p ? { earned: e, possible: p, pct: e / p * 100 } : null;
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
    $('wkDate').value = lastFriday(); switchTab('wig');
  }
  function switchTab(t) {
    ['wig', 'weekly', 'report'].forEach(x => { $('tab-' + x).classList.toggle('hidden', x !== t); $('tabBtn-' + x).classList.toggle('active', x === t); });
    if (t === 'wig') renderWig();
    if (t === 'weekly') { loadWeek(); renderWeekTable(); }
    if (t === 'report') { renderMonthlyTables(); renderRepMonthPicker(); }
  }

  function renderWig() {
    const d = cData(); if (!d) return; const b = d.board;
    $('wMetric').value = b?.metric || ''; $('wGoal').value = b?.goal ?? ''; $('wStart').value = b?.start || ''; $('wEnd').value = b?.end || '';
    const bc = boardCalc(d); const status = $('sbStatus'); const entry = $('sbEntry');
    if (bc) {
      entry.classList.remove('hidden');
      entry.innerHTML = `<div class="sb-entry">
        <label for="g-sbCurInput">Where we're up to</label>
        <input id="g-sbCurInput" type="number" min="0" step="any" value="${b.current ?? ''}" placeholder="0" onchange="Growth.saveCurrent(this.value)">
        <span class="se-metric">${esc(b.metric || '')} of ${b.goal}</span>
        <span class="se-hint">Update this in the WIG meeting</span></div>`;
      status.className = 'sb-status ' + (bc.winning == null ? 'idle' : (bc.winning ? 'win' : 'lose'));
      status.textContent = bc.winning == null ? 'Enter where you’re up to to see winning / losing' : (bc.winning ? 'WINNING' : 'LOSING');
      renderScoreBars(d, bc);
    } else {
      entry.classList.add('hidden'); entry.innerHTML = '';
      status.className = 'sb-status idle'; status.textContent = 'No scoreboard yet — set the WIG below';
      $('sbBars').innerHTML = ''; $('sbMeta').innerHTML = '';
    }
    renderPeriods();
  }
  function renderScoreBars(d, bc) {
    const b = d.board; const cur2 = bc.current ?? 0, goal = b.goal, pace = bc.pacing; const max = Math.max(cur2, goal, pace, 1);
    const bar = (cls, l, v) => `<div class="sb-bar ${cls}"><div class="b-num">${Math.round(v * 10) / 10}</div><div class="b-fill" style="height:${Math.max(2, v / max * 140)}px"></div><div class="b-lbl">${l}</div></div>`;
    $('sbBars').innerHTML = bar('mtd', 'MTD', cur2) + bar('goal', 'Goal', goal) + bar('pace', 'Pacing', pace);
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
    const people = (cRec()?.people || []).map(n => ({ name: n, hot: '', later: '', renew: '', refer: '', commit: '', commitDone: false, wig: '', wigDone: false }));
    const locked = d.periods.filter(p => p.locked).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    let start = todayStr();
    if (locked.length && locked[locked.length - 1].end) { const nd = new Date(locked[locked.length - 1].end + 'T00:00'); nd.setDate(nd.getDate() + 1); start = nd.toISOString().slice(0, 10); }
    const ed = new Date(start + 'T00:00'); ed.setDate(ed.getDate() + 6);
    d.periods.push({ id: 'p' + Date.now(), start, end: ed.toISOString().slice(0, 10), locked: false, people });
  }
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
    let hint = '';
    if (isOpen) {
      const d = cData(), bc = boardCalc(d);
      if (bc) {
        const target = boardPacingAtDate(d, p.end); const need = Math.max(0, Math.ceil(target - (bc.current ?? 0)));
        hint = `<div class="pacing-hint">To be on pace by <b>${shortDate(p.end)}</b> the scoreboard needs <b>${Math.round(target)}</b> ${esc(d.board.metric || 'units')} — you have <b>${bc.current ?? 0}</b>, so this period needs <b>${need} more</b>.</div>`;
      }
    }
    const head = isOpen
      ? `<div class="period-head">
           <span class="ph-tag now">This period</span>
           <div class="ph-dates">
             <label class="ph-field"><span>From</span><input type="date" value="${p.start}" onchange="Growth.updPeriodDate('${p.id}','start',this.value)"></label>
             <span class="ph-arrow">→</span>
             <label class="ph-field"><span>To</span><input type="date" value="${p.end}" onchange="Growth.updPeriodDate('${p.id}','end',this.value)"></label>
           </div></div>`
      : `<div class="period-head"><div class="ph-title">${shortDate(p.start)} → ${shortDate(p.end)}</div><span class="ph-tag past">Locked</span></div>`;
    wrap.innerHTML = head + hint + '<div class="pb-people"></div>';
    const peopleHost = wrap.querySelector('.pb-people');
    (p.people || []).forEach(pn => peopleHost.appendChild(personBlock(p, pn, isOpen)));
    if (isOpen) {
      const save = document.createElement('div'); save.style.marginTop = '16px'; save.style.paddingTop = '16px'; save.style.borderTop = '1px solid var(--g-lightgrey)';
      save.innerHTML = `<button class="accent" onclick="Growth.savePeriod('${p.id}')">Save &amp; close this period</button><span class="muted" style="font-size:12.5px; margin-left:12px;">Scores lock and a fresh period opens.</span>`;
      wrap.appendChild(save);
    }
    return wrap;
  }
  function personBlock(period, pn, isOpen) {
    const div = document.createElement('div'); div.className = 'person-block'; div.dataset.name = pn.name;
    const lr = commitPctPerson(cData(), pn.name); const pts = (pn.wigDone ? 1 : 0) + (pn.commitDone ? 1 : 0);
    if (period.locked) div.classList.add(pts === 2 ? 'full' : pts === 0 ? 'zero' : '');
    const headRight = isOpen
      ? `<button class="linkish" onclick="Growth.removePerson('${period.id}','${esc(pn.name)}')">remove</button>`
      : `<div class="score-readonly"><div class="sr"><span class="sdot ${pn.wigDone ? 'hit' : 'miss'}"></span> WIG</div>
           <div class="sr"><span class="sdot ${pn.commitDone ? 'hit' : 'miss'}"></span> Commitment</div>
           <div class="pb-score"><span>${pts}</span> / 2</div></div>`;
    const head = `<div class="pb-head">
        <div class="pb-name-wrap"><h4>${esc(pn.name)}</h4>${lr ? `<span class="muted" style="font-size:13px;">${Math.round(lr.pct)}% long-run</span>` : ''}</div>
        ${headRight}</div>`;
    if (!isOpen) {
      div.innerHTML = head + `<div class="wig-commit-grid">
          <div><label>WIG</label><div class="computed">${esc(pn.wig || '—')}</div></div>
          <div><label>Commitment</label><div class="computed">${esc(pn.commit || '—')}</div></div></div>`;
      return div;
    }
    div.innerHTML = head + `
      <div class="wig-commit-grid">
        <div><label>WIG this period — outcome needed</label><input class="pc-wig" value="${esc(pn.wig || '')}" placeholder="e.g. 4 assessments paid"></div>
        <div><label>Commitment — specific, binary, in ${esc(pn.name)}'s control</label><input class="pc-commit" value="${esc(pn.commit || '')}" placeholder="e.g. Call all 6 hot leads + record 1 sales call"></div>
      </div>
      <details class="coach">
        <summary>Lead inventory &amp; coaching notes</summary>
        <div class="coach-inner"><div class="leadgrid">
          <div><label>Hot leads — ≥50% this period</label><textarea class="pc-hot" rows="2">${esc(pn.hot || '')}</textarea></div>
          <div><label>Later — good, not now (say when)</label><textarea class="pc-later" rows="2">${esc(pn.later || '')}</textarea></div>
          <div><label>Renewals / retests</label><textarea class="pc-renew" rows="2">${esc(pn.renew || '')}</textarea></div>
          <div><label>Referrals</label><textarea class="pc-refer" rows="2">${esc(pn.refer || '')}</textarea></div>
        </div></div>
      </details>
      <div class="score-row">
        <label class="chkbox"><input type="checkbox" class="pc-wigdone" ${pn.wigDone ? 'checked' : ''} onchange="Growth.tickPerson(this)"> Hit the WIG</label>
        <label class="chkbox"><input type="checkbox" class="pc-commitdone" ${pn.commitDone ? 'checked' : ''} onchange="Growth.tickPerson(this)"> Fulfilled commitment</label>
        <div class="pb-score"><span class="pb-n">${pts}</span> / 2 this period</div>
      </div>`;
    return div;
  }
  function tickPerson(el) { const b = el.closest('.person-block'); const pts = (b.querySelector('.pc-wigdone').checked ? 1 : 0) + (b.querySelector('.pc-commitdone').checked ? 1 : 0); b.querySelector('.pb-n').textContent = pts; }
  async function updPeriodDate(pid, f, v) { const p = cData().periods.find(x => x.id === pid); if (p) { p[f] = v; await persist(); renderWig(); } }
  function collectOpenPeriod(pid) {
    const wrap = document.querySelector(`#tab-growth .period[data-pid="${pid}"]`); if (!wrap) return null;
    const people = []; const val = (b, s) => { const el = b.querySelector(s); return el ? el.value : ''; }; const chk = (b, s) => { const el = b.querySelector(s); return el ? el.checked : false; };
    wrap.querySelectorAll('.person-block').forEach(b => people.push({
      name: b.dataset.name, hot: val(b, '.pc-hot'), later: val(b, '.pc-later'),
      renew: val(b, '.pc-renew'), refer: val(b, '.pc-refer'),
      commit: val(b, '.pc-commit'), commitDone: chk(b, '.pc-commitdone'),
      wig: val(b, '.pc-wig'), wigDone: chk(b, '.pc-wigdone'),
    }));
    return people;
  }
  async function savePeriod(pid) {
    const d = cData(), p = d.periods.find(x => x.id === pid); if (!p) return;
    const people = collectOpenPeriod(pid); if (people) p.people = people;
    p.locked = true; ensureOpenPeriod();
    const ok = await persist(); renderWig(); renderDash();
    toast(ok ? 'Period locked — new period opened' : 'Save failed');
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

  function loadWeek() {
    const k = $('wkDate').value; if (!k) { $('weekForm').classList.add('hidden'); return; }
    const w = cData().weeks[k] || {};
    $('aSpend').value = w.ads?.spend ?? ''; $('aImpr').value = w.ads?.impr ?? ''; $('aClicks').value = w.ads?.clicks ?? ''; $('aLeads').value = w.ads?.leads ?? '';
    $('pBooked').value = w.pipe?.booked ?? ''; $('pShowed').value = w.pipe?.showed ?? ''; $('pClosed').value = w.pipe?.closed ?? ''; $('pRev').value = w.pipe?.rev ?? '';
    $('weekForm').classList.remove('hidden'); recalcWeek();
  }
  function nv(id) { const v = parseFloat($(id).value); return isNaN(v) ? null : v; }
  function recalcWeek() {
    const spend = nv('aSpend'), impr = nv('aImpr'), clicks = nv('aClicks'), leads = nv('aLeads');
    const booked = nv('pBooked'), showed = nv('pShowed'), closed = nv('pClosed');
    const set = (id, v) => { const e = $(id); e.textContent = v; e.classList.toggle('on', v !== '—'); };
    set('xCPM', (spend != null && impr) ? fmt$(spend / impr * 1000) : '—');
    set('xCTR', (clicks != null && impr) ? fmtP(clicks / impr * 100) : '—');
    set('xOpt', (leads != null && clicks) ? fmtP(leads / clicks * 100) : '—');
    set('xCPL', (spend != null && leads) ? fmt$(spend / leads) : '—');
    set('xBook', (booked != null && leads) ? fmtP(booked / leads * 100) : '—');
    set('xShow', (showed != null && booked) ? fmtP(showed / booked * 100) : '—');
    set('xClose', (closed != null && showed) ? fmtP(closed / showed * 100) : '—');
  }
  async function saveWeek() {
    const k = $('wkDate').value; if (!k) { toast('Pick the week-ending date'); return; }
    cData().weeks[k] = { ads: { spend: nv('aSpend'), impr: nv('aImpr'), clicks: nv('aClicks'), leads: nv('aLeads') }, pipe: { booked: nv('pBooked'), showed: nv('pShowed'), closed: nv('pClosed'), rev: nv('pRev') } };
    const ok = await persist(); toast(ok ? 'Week saved' : 'Save failed'); renderWeekTable(); renderDash();
  }
  function renderWeekTable() {
    const tb = $('weekTable').querySelector('tbody'); tb.innerHTML = ''; const d = cData();
    weekKeys(d).forEach(k => {
      const w = d.weeks[k]; const cpl = (w.ads?.spend != null && w.ads?.leads) ? w.ads.spend / w.ads.leads : null;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${k}</td><td>${fmt$(w.ads?.spend)}</td><td>${fmtN(w.ads?.leads)}</td><td>${fmt$(cpl)}</td><td>${fmtN(w.pipe?.booked)}</td><td>${fmtN(w.pipe?.showed)}</td><td>${fmtN(w.pipe?.closed)}</td><td>${fmt$(w.pipe?.rev)}</td><td><button class="linkish" onclick="event.stopPropagation();Growth.delWeek('${k}')">delete</button></td>`;
      tr.onclick = () => { $('wkDate').value = k; loadWeek(); document.getElementById('tab-growth')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      tb.appendChild(tr);
    });
  }
  async function delWeek(k) { if (!confirm('Delete week ending ' + k + '?')) return; delete cData().weeks[k]; await persist(); renderWeekTable(); renderDash(); }

  function renderMonthlyTables() {
    const d = cData(), mosAsc = monthKeys(d), host = $('monthlyTables');
    if (!mosAsc.length) { host.innerHTML = '<div class="card"><p class="muted">This table builds itself once weekly data is entered.</p></div>'; return; }
    const cols = mosAsc.slice().reverse();
    const tot = totalAgg(d);
    const aggByMo = {}; cols.forEach(mo => aggByMo[mo] = monthAgg(d, mo));
    const sym = cRec()?.currency || '£';

    const head = '<tr><th></th><th>Total</th>' + cols.map(m => '<th>' + monthLabel(m) + '</th>').join('') + '</tr>';
    const row = (label, fn, cls) => `<tr><td>${label}</td><td class="${cls || ''}">${fn(tot)}</td>` + cols.map(mo => `<td class="${cls || ''}">${fn(aggByMo[mo])}</td>`).join('') + '</tr>';
    const spacer = `<tr class="tspace"><td colspan="${cols.length + 2}"></td></tr>`;

    let feeTotal = 0; cols.forEach(mo => feeTotal += feeFor(d, mo));
    const feeRow = `<tr><td>Our fee</td><td>${money(feeTotal, sym)}</td>` +
      cols.map(mo => `<td><input class="fee-in" type="number" min="0" step="0.01" value="${d.fees[mo] ?? ''}" placeholder="${cRec()?.fee ?? ''}" onchange="Growth.setFee('${mo}',this.value)"></td>`).join('') + '</tr>';

    const rc = v => v == null ? '' : (v >= 1.5 ? 'roi-cell-good' : v >= 1 ? 'roi-cell-warn' : 'roi-cell-bad');

    const body =
      feeRow + spacer +
      row('Ad spend', a => money(a.spend || null, sym)) +
      row('CPM', a => money(a.cpm, sym)) +
      row('Impressions', a => fmtN(a.impr || null)) +
      row('Link CTR', a => fmtP2(a.ctr)) +
      row('Clicks', a => fmtN(a.clicks || null)) +
      row('Opt in %', a => fmtP2(a.optin)) +
      row('Leads', a => fmtN(a.leads || null)) +
      row('Booking %', a => fmtP0(a.bookPct)) +
      row('Bookings', a => fmtN(a.booked || null)) +
      row('Show rate %', a => fmtP0(a.showPct)) +
      row('Shows', a => fmtN(a.showed || null)) +
      row('Close rate %', a => fmtP0(a.closePct)) +
      row('Sales Made', a => fmtN(a.closed || null)) +
      spacer +
      row('CAC', a => money(a.cac, sym)) +
      row('Total New Revenue', a => money(a.rev || null, sym)) +
      spacer +
      row('ROAS', a => fmt2(a.roas)) +
      `<tr><td>ROI</td><td class="${rc(tot.roi)}">${fmt2(tot.roi)}</td>` + cols.map(mo => `<td class="${rc(aggByMo[mo].roi)}">${fmt2(aggByMo[mo].roi)}</td>`).join('') + '</tr>';

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
        <div class="sb-bars" style="max-width:420px; height:160px; margin-bottom:28px;">${bar('mtd', 'Now', bc.current)}${bar('goal', 'Goal', d.board.goal)}${bar('pace', 'Pacing', bc.pacing)}</div>`;
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
    if (monthPeriods.length) {
      const names = [...new Set(monthPeriods.flatMap(p => p.people.map(x => x.name)))];
      let totE = 0, totP = 0, persons = '';
      names.forEach(n => {
        let rows = '', e = 0, poss = 0;
        monthPeriods.slice().sort((a, b) => (a.end || '').localeCompare(b.end || '')).forEach(p => {
          const pn = p.people.find(x => x.name === n); if (!pn) return; poss += 2; e += (pn.wigDone ? 1 : 0) + (pn.commitDone ? 1 : 0);
          rows += `<div style="display:grid; grid-template-columns:120px 1fr 1fr; gap:10px; font-size:13px; align-items:center; border-bottom:1px solid var(--g-lightgrey); padding:7px 0;">
            <div style="font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#7d766e;">${shortDate(p.start)}–${shortDate(p.end)}</div>
            <div><span class="sdot ${pn.wigDone ? 'hit' : 'miss'}" style="display:inline-block; margin-right:6px; vertical-align:middle;"></span>WIG: ${esc(pn.wig || '—')}</div>
            <div><span class="sdot ${pn.commitDone ? 'hit' : 'miss'}" style="display:inline-block; margin-right:6px; vertical-align:middle;"></span>Commitment: ${esc(pn.commit || '—')}</div></div>`;
        });
        totE += e; totP += poss; const lr = commitPctPerson(d, n);
        persons += `<div style="margin-top:14px;"><h4 style="font-family:var(--g-serif); font-size:17px; margin-bottom:6px;">${esc(n)} — ${e}/${poss} this month${lr ? ` · ${Math.round(lr.pct)}% long-run` : ''}</h4>${rows}</div>`;
      });
      const pct = totP ? totE / totP * 100 : 0;
      const verdict = pct >= 80 ? 'Scoreboard held — the system works when both sides play.' : pct >= 50 ? 'Partial scoreboard — results track with the commitments missed.' : 'Scoreboard mostly missed — ad results only convert when the weekly commitments get done.';
      acct = `<div style="border-top:3px solid var(--g-charcoal); padding-top:16px; margin-top:6px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px;">
          <h3 style="font-size:21px;">The scoreboard — your side of the system</h3>
          <div style="font-family:var(--g-serif); font-size:26px;"><span style="color:var(--g-orange);">${totE}</span> / ${totP} points</div></div>
        ${persons}<p style="font-size:13.5px; margin-top:12px; color:#57524c;">${verdict}</p></div>`;
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
    saveBoard, saveCurrent, addPerson, updPeriodDate, savePeriod, removePerson, tickPerson,
    loadWeek, recalcWeek, saveWeek, delWeek, setFee, setClientCurrency,
    showReport, saveMonthNotes, backToClient,
  };
})();
