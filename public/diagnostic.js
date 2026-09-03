/* ── Diagnostic (Scoreboard intake instrument) ────────────────────────────────
   Implements the "Gathr Grow — The Scoreboard: Instrument Spec v1" intake:
   tick-box diagnostic → live score → recommendation engine → printable
   strategy PDF. Self-contained IIFE, exposed only via window.Diagnostic, own
   persistence via /api/diagnostic/*, same isolation pattern as growth.js. */
(function () {
  let assessments = [], cur = null;

  const $ = id => document.getElementById('dg-' + id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function niceDate(s) { return s ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; }

  async function apiGet(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  async function apiSend(url, method, body) {
    try { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }

  // ── Practitioner type → config group ──────────────────────────────────────
  const PRACTITIONER_TYPES = [
    { v: 'physio', l: 'Physiotherapist', g: 'A' }, { v: 'chiro', l: 'Chiropractor', g: 'A' },
    { v: 'podiatrist', l: 'Podiatrist', g: 'A' }, { v: 'psychologist', l: 'Psychologist', g: 'A' },
    { v: 'ep', l: 'Exercise physiologist', g: 'B' }, { v: 'dietitian', l: 'Dietitian', g: 'B' },
    { v: 'counsellor', l: 'Counsellor / therapist', g: 'B' }, { v: 'massage', l: 'Massage therapist', g: 'B' },
    { v: 'pt', l: 'Personal trainer', g: 'C' }, { v: 'coach', l: 'Coach', g: 'C' }, { v: 'nutritionist', l: 'Nutritionist', g: 'C' },
    { v: 'beauty', l: 'Beauty / aesthetics', g: 'D' },
  ];
  const CONFIG_GROUPS = {
    A: {
      label: 'Group A — Registered health practitioner',
      compliance: 'No paid or incentivised patient referrals. No clinical testimonials in their own marketing — steer collected reviews toward service and experience, not outcomes. Keep every message free of clinical detail.',
      proofNote: 'Educational and service-experience content, not before/after or outcome claims.',
      directories: 'Association directory, Whitecoat, HotDoc/HealthEngine (optional paid). Psychologists: Psychology Today (~$25/mo) dominates search there.',
    },
    B: {
      label: 'Group B — Allied health (non-AHPRA)',
      compliance: 'Testimonials are allowed.',
      proofNote: 'Testimonials allowed; keep the tone professional and service-focused.',
      directories: "Their body's free listing (ESSA, Dietitians Australia, PACFA/ACA, or the relevant massage association) plus Whitecoat.",
    },
    C: {
      label: 'Group C — Fitness / coaching',
      compliance: 'No professional-directory compliance constraints. Before/after transformations and video testimonials are expected proof, not just allowed.',
      proofNote: 'Before-and-afters, transformations and video testimonials are expected proof and score directly.',
      directories: 'No professional directories apply — Google, Gathr and local listings carry more weight instead.',
    },
    D: {
      label: 'Group D — Beauty / aesthetics',
      compliance: 'Same proof standard as Group C. If a nurse or doctor delivers or oversees treatment, Group A compliance applies instead (no incentivised referrals, no clinical testimonials).',
      proofNote: 'Before-and-afters, transformations and client stories are expected proof.',
      directories: 'Fresha, Bookwell (note the commission), plus general local listings.',
    },
  };
  function groupFor(type, nurseFlag) {
    const t = PRACTITIONER_TYPES.find(x => x.v === type);
    if (!t) return 'C';
    if (t.g === 'D' && nurseFlag) return 'A';
    return t.g;
  }

  // ── The instrument: sections, weights, questions ──────────────────────────
  // Every scored question: {id, text, sub, options:[{v,l}], na:{label} or null}
  // v: 0/1/2 or 'na'. Section weight and job come from SECTIONS below.
  const Q = {
    C1: { text: "Right now, roughly: last month, how many leads, how many booked, how many showed, how many became clients?", sub: 'A capability test, not a survey question — score what they can actually produce.',
      options: [{ v: 2, l: '2 · Produces all four, even approximate, from a system or a sheet' }, { v: 1, l: '1 · Knows some, or can reconstruct roughly' }, { v: 0, l: '0 · Cannot produce them' }] },
    C2: { text: 'Do you ask every new client how they heard about you, and document it somewhere?',
      options: [{ v: 2, l: '2 · Asked and recorded every time' }, { v: 1, l: '1 · Asks sometimes, or asks but never records' }, { v: 0, l: '0 · No' }] },
    C3: { text: 'Do you know what an average client is worth to you in dollars?',
      options: [{ v: 2, l: '2 · Has a number without help' }, { v: 1, l: '1 · Gets there with a shortcut (package price, or session price × typical sessions)' }, { v: 0, l: '0 · No idea' }] },
    C4: { text: 'Is there one place where every lead and their status lives?',
      options: [{ v: 2, l: '2 · One system, statuses kept current' }, { v: 1, l: '1 · Scattered — notes, phone, memory' }, { v: 0, l: '0 · Nowhere' }] },

    D2: { text: 'Have you reached out to past or lapsed clients in the last 90 days?',
      options: [{ v: 2, l: '2 · Yes, personally and systematically — most of the list, personalised' }, { v: 1, l: '1 · A few, ad hoc' }, { v: 0, l: '0 · No' }, { v: 'na', l: 'N/A · No past clients yet (brand new)' }] },
    D3: { text: 'When you reach out, do you lead with something useful (a check-in, a tip, a free reassessment) rather than an ask to book?',
      sub: 'Skip if D2 was No or N/A — do not punish twice.',
      options: [{ v: 2, l: '2 · Give first, personalised, "who do you know" rather than "do you want this"' }, { v: 1, l: '1 · Sometimes, or a generic message' }, { v: 0, l: '0 · Straight pitch' }, { v: 'na', l: 'N/A · Skip (D2 was No / N/A)' }] },
    D4: { text: 'Does your warm network — friends, colleagues, the gym, referral partners — know exactly who you help and that you are taking clients?',
      options: [{ v: 2, l: '2 · Told specifically and recently' }, { v: 1, l: '1 · Vaguely, or once, a long time ago' }, { v: 0, l: '0 · No' }] },

    D5: { text: 'Do you ask happy clients for referrals at the peak moment, for an introduction to a specific kind of person?',
      options: [{ v: 2, l: '2 · Habitual, timed to a win, specific, easy to act on, thanked' }, { v: 1, l: '1 · Asks sometimes, or vaguely ("tell your friends")' }, { v: 0, l: '0 · Never asks' }, { v: 'na', l: 'N/A · No completed clients yet' }] },
    D6: { text: 'Do you have at least one professional pathway (a GP, an EP, a complementary business) that actually sends people, with something flowing back the other way?',
      options: [{ v: 2, l: '2 · Active pathway with reciprocity — summary letters back, cross-referrals' }, { v: 1, l: '1 · Relationship exists, nothing flowing yet' }, { v: 0, l: '0 · None' }] },

    D7: { text: 'Is your Google Business Profile set up and properly filled in — right categories, services, photos, hours, booking link?',
      options: [{ v: 2, l: '2 · Complete and accurate, real trading name, no keyword stuffing' }, { v: 1, l: '1 · Exists but thin or partly wrong' }, { v: 0, l: '0 · No profile' }] },
    D8: { text: 'How many Google reviews do you have, and how recent is the newest?', sub: '2 = 30 or more. 1 = 5 to 29. 0 = under 5. Freshness (something in the last month) matters more than a big old pile.',
      options: [{ v: 2, l: '2 · 30 or more' }, { v: 1, l: '1 · 5 to 29' }, { v: 0, l: '0 · Under 5' }] },
    D9: { text: 'Do you have a one-tap review link, and a habit of asking at the peak moment?',
      options: [{ v: 2, l: '2 · Direct link plus a regular asking rhythm' }, { v: 1, l: '1 · Asks occasionally, no system' }, { v: 0, l: '0 · Never asks' }] },
    D10: { text: 'Do you reply to every review?',
      options: [{ v: 2, l: '2 · All of them, promptly, good or difficult' }, { v: 1, l: '1 · Some' }, { v: 0, l: '0 · None' }, { v: 'na', l: 'N/A · No reviews yet' }] },
    D11: { text: 'Are your name, address and phone identical everywhere online?',
      options: [{ v: 2, l: '2 · Checked and consistent' }, { v: 1, l: '1 · Unsure, probably' }, { v: 0, l: '0 · Known inconsistencies' }] },

    D12: { text: 'Do you have your own website that loads fast and works properly on a phone, no broken pages?',
      options: [{ v: 2, l: '2 · Yes, fast, mobile-clean, every link works' }, { v: 1, l: '1 · Exists but slow, dated, or something is broken' }, { v: 0, l: '0 · No site, social only' }] },
    D13: { text: 'Does the first screen say who you help, and give one clear next step?',
      options: [{ v: 2, l: '2 · Clear who-and-what headline plus a visible book/call button in the hero' }, { v: 1, l: '1 · CTA buried, or a vague headline' }, { v: 0, l: '0 · Neither' }] },
    D14: { text: 'Is there a page for each main service, written in the plain words people actually search?',
      options: [{ v: 2, l: '2 · Yes, one per service, plain language' }, { v: 1, l: '1 · One generic services page' }, { v: 0, l: '0 · No' }] },
    D15: { text: 'Structured business details on the site matching your Google profile, plus any independent mentions or best-of lists?',
      options: [{ v: 2, l: '2 · Present and consistent, plus at least one independent mention' }, { v: 1, l: '1 · Partial, or unsure' }, { v: 0, l: '0 · None of it' }] },

    D16: { text: 'Are you listed on the directories that matter for your profession, details identical, each linking back to your booking page?',
      options: [{ v: 2, l: '2 · On the key listings for their type, consistent and linked' }, { v: 1, l: '1 · Some listings, or details out of date' }, { v: 0, l: '0 · None' }] },
    D17: { text: 'Do any memberships you already pay for include a find-a-practitioner listing, and is it switched on?',
      options: [{ v: 2, l: '2 · Yes and live' }, { v: 1, l: '1 · Member, listing not switched on (the sleeper win)' }, { v: 'na', l: 'N/A · No such membership' }] },

    D18: { text: 'Are you posting short, engaging videos at least three times a week, most weeks?', sub: 'Consistency beats volume, roughly five to one.',
      options: [{ v: 2, l: '2 · 3 to 4 a week, consistently' }, { v: 1, l: '1 · Sporadic, or images/graphics only' }, { v: 0, l: '0 · Rarely or never' }] },
    D19: { text: 'Does your content answer real client questions, and end with a next step?',
      options: [{ v: 2, l: '2 · Strong hook, strong retention, one idea per piece, clear next step' }, { v: 1, l: '1 · Generic or purely branded graphics' }, { v: 'na', l: 'N/A · No content at all (already counted at D18)' }] },
    D20: { text: 'If a stranger checked your profile today, does it look alive — recent posts, clear bio, booking link?',
      options: [{ v: 2, l: '2 · Alive and clear' }, { v: 1, l: '1 · Partly' }, { v: 0, l: '0 · Ghost town' }] },

    E1: { text: 'When someone is interested but not ready to book, how do you capture them?',
      options: [{ v: 2, l: '2 · A deliberate capture step — a form, a lead magnet, a discovery-call booking' }, { v: 1, l: '1 · Informal — DMs, they have my number' }, { v: 0, l: '0 · Nothing; interest evaporates' }] },
    E2: { text: 'When you run a campaign or promotion, where do people land?',
      options: [{ v: 2, l: '2 · One focused page, one action, matching the message they clicked' }, { v: 1, l: '1 · The homepage, or a multi-purpose page' }, { v: 0, l: '0 · Nowhere, or straight into a platform form with no page' }, { v: 'na', l: 'N/A · Has never run any campaign' }] },
    E3: { text: 'What is the first step you offer — is it named and specific, or a free consult?',
      options: [{ v: 2, l: '2 · A named, specific, valuable first step' }, { v: 1, l: '1 · A generic free consult' }, { v: 0, l: '0 · Just "contact us"' }] },
    E4: { text: 'How long is the form, and does it qualify anyone out?',
      options: [{ v: 2, l: '2 · Short, only needed fields, plus the one qualifying question that matters' }, { v: 1, l: '1 · Long, or captures everything and qualifies nothing' }, { v: 'na', l: 'N/A · No form anywhere' }] },

    F1: { text: 'Your last inbound lead — how fast was your first reply?',
      options: [{ v: 2, l: '2 · Within 5 minutes, or a near-instant text' }, { v: 1, l: '1 · Same day' }, { v: 0, l: '0 · Next day or longer, or does not know' }] },
    F2: { text: 'If you cannot call, does a text go out immediately, and does it ask a question rather than just confirm receipt?',
      options: [{ v: 2, l: '2 · Instant text with a question that opens a conversation' }, { v: 1, l: '1 · An automated "we got it" confirmation only' }, { v: 0, l: '0 · Nothing' }] },

    F3: { text: 'Your last lead who went quiet — how many times did you follow up before stopping?',
      options: [{ v: 2, l: '2 · 5 to 8 touches across 2 to 3 weeks' }, { v: 1, l: '1 · 2 to 4' }, { v: 0, l: '0 · 0 or 1' }] },
    F4: { text: 'Did those touches mix channels and have air between them?', sub: 'Skip if F3 was 0.',
      options: [{ v: 2, l: '2 · Call, text and email mixed, spaced out — not a daily barrage' }, { v: 1, l: '1 · One channel, or crammed into a couple of days' }, { v: 'na', l: 'N/A · Skip (F3 was 0)' }] },
    F5: { text: 'Do you end cleanly — a clear final message, and check back in 3 to 4 weeks later?',
      options: [{ v: 2, l: '2 · Both — a warm "I’ll leave you be", and a later check-in' }, { v: 1, l: '1 · One of the two' }, { v: 0, l: '0 · Neither; leads just fade out' }] },

    F6: { text: 'When someone books, how far out is the appointment usually?',
      options: [{ v: 2, l: '2 · Within 3 to 4 days' }, { v: 1, l: '1 · Within a week' }, { v: 0, l: '0 · Often two weeks or more' }] },
    F7: { text: 'What happens between booking and showing up?',
      options: [{ v: 2, l: '2 · 2 to 3 reminders by text/email, a reply-to-confirm, one-tap reschedule' }, { v: 1, l: '1 · A single reminder' }, { v: 0, l: '0 · Nothing' }] },

    F8: { text: 'In the consult, do you set the agenda up front, then spend most of it understanding their problem and goal before recommending anything?',
      options: [{ v: 2, l: '2 · Yes — agenda agreed, listens first' }, { v: 1, l: '1 · Partly, unstructured' }, { v: 0, l: '0 · Jumps straight to the pitch' }] },
    F9: { text: 'Do you actually ask for the sale — a clear recommendation and a direct ask?',
      options: [{ v: 2, l: '2 · Every time: "here’s what I recommend, how does that sit with you?"' }, { v: 1, l: '1 · Sometimes, or hints and waits' }, { v: 0, l: '0 · Waits for the client to raise it' }] },
    F10: { text: 'When someone objects, what happens next?',
      options: [{ v: 2, l: '2 · Restate, isolate, overcome, smaller first step ready if needed' }, { v: 1, l: '1 · Improvises' }, { v: 0, l: '0 · Folds, or discounts immediately' }] },
  };

  const SECTIONS = [
    { key: 'measure', label: 'Measure', weight: 10, job: 'measure', qids: ['C1', 'C2', 'C3', 'C4'] },
    { key: 'outreach', label: 'Outreach & Reactivation', weight: 10, job: 'getfound', qids: ['D2', 'D3', 'D4'] },
    { key: 'referrals', label: 'Referrals', weight: 4, job: 'getfound', qids: ['D5', 'D6'] },
    { key: 'reviews', label: 'Reviews & Google', weight: 9, job: 'getfound', qids: ['D7', 'D8', 'D9', 'D10', 'D11'] },
    { key: 'website', label: 'Website', weight: 8, job: 'getfound', qids: ['D12', 'D13', 'D14', 'D15'] },
    { key: 'directories', label: 'Directories', weight: 4, job: 'getfound', qids: ['D16', 'D17'] },
    { key: 'content', label: 'Content & Social', weight: 5, job: 'getfound', qids: ['D18', 'D19', 'D20'] },
    { key: 'capture', label: 'Capture Interest', weight: 15, job: 'capture', qids: ['E1', 'E2', 'E3', 'E4'] },
    { key: 'speed', label: 'Speed to Reply', weight: 10, job: 'sell', qids: ['F1', 'F2'] },
    { key: 'followup', label: 'Follow-up', weight: 10, job: 'sell', qids: ['F3', 'F4', 'F5'] },
    { key: 'show', label: 'Show Rate', weight: 7, job: 'sell', qids: ['F6', 'F7'] },
    { key: 'sales', label: 'Sales Conversation', weight: 8, job: 'sell', qids: ['F8', 'F9', 'F10'] },
  ];
  const JOBS = {
    getfound: { label: 'Get Found', max: 40 },
    capture: { label: 'Capture Interest', max: 15 },
    sell: { label: 'Sell', max: 35 },
    measure: { label: 'Measure', max: 10 },
  };
  // Active vs passive split, for the client-facing "Get Found" page.
  const GETFOUND_ACTIVE = ['outreach', 'referrals'];
  const GETFOUND_PASSIVE = ['reviews', 'website', 'directories', 'content'];

  function fresh() {
    return {
      businessName: '', contactName: '', createdAt: todayStr(),
      answers: {
        practitionerType: '', nurseFlag: false, businessAge: '', teamSize: '', servesArea: '', runningAds: '',
        idealClient: '', mainOffer: '', avgClientValue: '', activeClients: '', targetNewClients: '',
        funnel: { leads: '', booked: '', showed: '', closed: '' },
        outreachListSize: '', ranEvents: '',
        biggestGap: '',
        ads: { landing: '', qualifies: '', creatives: '', knowsCost: '', platforms: '', cadence: '' },
        q: {}, // scored question answers, keyed by question id
      },
    };
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  function sectionScore(a, sec) {
    let earned = 0, applicableRaw = 0;
    sec.qids.forEach(qid => {
      const v = a.answers.q[qid];
      if (v === undefined || v === null || v === '' || v === 'na') return;
      applicableRaw += 2;
      earned += Number(v);
    });
    const maxRaw = sec.qids.length * 2;
    if (applicableRaw === 0) return { earned: 0, applicableRaw: 0, maxRaw, weighted: null, pct: null, chip: 'tooearly' };
    const pct = earned / applicableRaw * 100;
    const weighted = Math.round(pct / 100 * sec.weight);
    const chip = pct >= 75 ? 'strong' : pct >= 40 ? 'needswork' : 'missing';
    return { earned, applicableRaw, maxRaw, weighted, pct, chip };
  }
  function computeScores(a) {
    const sections = {};
    SECTIONS.forEach(sec => { sections[sec.key] = sectionScore(a, sec); });
    const jobs = {};
    Object.keys(JOBS).forEach(j => { jobs[j] = { score: 0, max: JOBS[j].max, anyApplicable: false }; });
    SECTIONS.forEach(sec => {
      const s = sections[sec.key];
      if (s.weighted != null) { jobs[sec.job].score += s.weighted; jobs[sec.job].anyApplicable = true; }
    });
    const headline = Object.values(jobs).reduce((sum, j) => sum + j.score, 0);
    return { sections, jobs, headline };
  }
  function chipLabel(chip) { return { strong: 'Strong', needswork: 'Needs work', missing: 'Missing', tooearly: 'Too early' }[chip] || '—'; }

  // ── Funnel benchmarks ──────────────────────────────────────────────────────
  function funnelPcts(f) {
    const leads = Number(f.leads) || 0, booked = Number(f.booked) || 0, showed = Number(f.showed) || 0, closed = Number(f.closed) || 0;
    return {
      leads, booked, showed, closed,
      bookPct: leads ? booked / leads * 100 : null,
      showPct: booked ? showed / booked * 100 : null,
      closePct: showed ? closed / showed * 100 : null,
      hasData: leads > 0 || booked > 0 || showed > 0 || closed > 0,
    };
  }

  // ── Recommendation engine ─────────────────────────────────────────────────
  function serviceFor(sectionKey) {
    if (sectionKey === 'measure' || sectionKey === 'website' || sectionKey === 'directories' || sectionKey === 'reviews' || sectionKey === 'capture') return 'Setup';
    if (sectionKey === 'content') return 'Content';
    if (['speed', 'followup', 'show', 'sales'].includes(sectionKey)) return 'Brand OS';
    return 'Setup';
  }
  function weakestApplicable(scores, keys) {
    let worst = null;
    keys.forEach(k => { const s = scores.sections[k]; if (s.weighted != null && (!worst || s.pct < worst.pct)) worst = { key: k, ...s }; });
    return worst;
  }
  function actionsFromSections(a, scores, keys, max) {
    const rows = [];
    keys.forEach(key => {
      const sec = SECTIONS.find(s => s.key === key);
      sec.qids.forEach(qid => {
        const v = a.answers.q[qid];
        if (v === 0 || v === 1 || v === '0' || v === '1') {
          rows.push({ qid, v: Number(v), sectionLabel: sec.label, sectionKey: key });
        }
      });
    });
    rows.sort((x, y) => x.v - y.v); // worst (0) first
    return rows.slice(0, max).map(r => {
      const q = Q[r.qid];
      const doneLooksLike = (q.options.find(o => o.v === 2) || {}).l || '';
      return { title: q.text, doneLooksLike: doneLooksLike.replace(/^2\s*·\s*/, ''), pageRef: `Guide: ${r.sectionLabel}`, sectionKey: r.sectionKey };
    });
  }
  function computeRecommendation(a, scores) {
    const funnel = funnelPcts(a.answers.funnel);
    const cantMeasure = a.answers.q.C1 === 0 || a.answers.q.C1 === '0' || !funnel.hasData;
    const group = groupFor(a.answers.practitionerType, a.answers.nurseFlag);
    const compliance = CONFIG_GROUPS[group]?.compliance || '';
    let priorityLabel, priorityBlurb, actions = [], mode = '';

    if (cantMeasure) {
      mode = 'measure';
      priorityLabel = 'Start measuring before anything else';
      priorityBlurb = "You can't manage what you can't see. Until you can produce leads, booked, showed and closed every month, any other fix is a guess.";
      actions.push({ title: 'Track your four numbers every month', doneLooksLike: 'Leads, booked, showed and closed recorded somewhere you can pull up on demand.', pageRef: 'Guide: Measure', sectionKey: 'measure' });
      const weakGF = weakestApplicable(scores, GETFOUND_ACTIVE.concat(GETFOUND_PASSIVE));
      if (weakGF) actions = actions.concat(actionsFromSections(a, scores, [weakGF.key], 2));
    } else if (funnel.bookPct != null && funnel.bookPct < 60) {
      mode = 'book';
      priorityLabel = 'Fix the booking stage';
      priorityBlurb = `Only ${Math.round(funnel.bookPct)}% of leads are turning into a booking, against a 60% floor. Everything downstream depends on this.`;
      actions = actionsFromSections(a, scores, ['capture', 'speed'], 3);
    } else if (funnel.showPct != null && funnel.showPct < 60) {
      mode = 'show';
      priorityLabel = 'Fix the show-up stage';
      priorityBlurb = `${Math.round(funnel.showPct)}% of bookings are actually showing up, against a 60% floor (healthy is 70%+).`;
      actions = actionsFromSections(a, scores, ['followup', 'show'], 3);
    } else if (funnel.closePct != null && funnel.closePct < 30) {
      mode = 'close';
      priorityLabel = 'Fix the close';
      priorityBlurb = `${Math.round(funnel.closePct)}% of people who show up become clients, against a 30% floor (healthy is 35%+).`;
      actions = actionsFromSections(a, scores, ['sales'], 3);
    } else {
      // All stages healthy — check growth mode
      const gfPct = scores.sections.outreach.pct != null || scores.sections.reviews.pct != null
        ? Object.values(scores.jobs.getfound).score : null;
      const getFoundHealthy = scores.jobs.getfound.score >= 30; // ~75% of 40
      const captureHealthy = scores.jobs.capture.score >= 11; // ~75% of 15
      if (getFoundHealthy && captureHealthy) {
        mode = 'growth';
        priorityLabel = 'Growth mode: you’re converting well, now grow volume';
        priorityBlurb = 'The funnel is healthy end to end. The constraint now is volume, not conversion. Content first, then the ads conversation.';
        actions = actionsFromSections(a, scores, ['content'], 2);
        if (a.answers.runningAds === 'yes') {
          actions.push({ title: 'Review paid ads for creative diversity', doneLooksLike: 'Multiple genuinely different creative angles live, judged on cost per client against client value, not cost per lead alone.', pageRef: 'Guide: Paid Ads', sectionKey: 'ads' });
        }
      } else {
        mode = 'polish';
        const weak = weakestApplicable(scores, Object.keys(scores.sections));
        priorityLabel = weak ? `Tighten up ${weak.label}` : 'Keep doing what’s working';
        priorityBlurb = 'Your funnel numbers are healthy. The highest-leverage next step is the weakest foundation channel underneath it.';
        if (weak) actions = actionsFromSections(a, scores, [weak.key], 3);
      }
    }

    // Quick wins — cheap, same-day fixes, independent of the main priority
    const quickWinIds = ['D7', 'D9', 'D16', 'D17'];
    const quickWins = quickWinIds
      .filter(qid => { const v = a.answers.q[qid]; return v === 0 || v === 1 || v === '0' || v === '1'; })
      .filter(qid => !actions.some(act => act.title === Q[qid].text))
      .slice(0, 2)
      .map(qid => ({ title: Q[qid].text, doneLooksLike: (Q[qid].options.find(o => o.v === 2) || {}).l.replace(/^2\s*·\s*/, ''), pageRef: 'Guide: Quick wins' }));

    const service = serviceFor(actions[0]?.sectionKey || 'measure');
    return { mode, priorityLabel, priorityBlurb, actions: actions.slice(0, 3), quickWins, compliance, group, service, funnel };
  }

  // ── LTV / GLTV ─────────────────────────────────────────────────────────────
  function ltvMath(a) {
    const ltv = Number(a.answers.avgClientValue) || 0;
    const gltv = ltv * 0.7; // ~30% margin removed, per spec note
    return { ltv, gltv };
  }

  // ── Data lifecycle ─────────────────────────────────────────────────────────
  async function onOpen() {
    assessments = (await apiGet('/api/diagnostic/assessments')) || [];
    if (cur && assessments.some(x => x.id === cur.id)) {
      openAssessment(cur.id);
    } else {
      showDash();
    }
  }
  function showDash() {
    $('formView').classList.add('hidden'); $('reportSection').classList.add('hidden'); $('dashView').classList.remove('hidden');
    renderDash();
  }
  function renderDash() {
    const grid = $('assessGrid'); if (!grid) return; grid.innerHTML = '';
    $('dashEmpty').classList.toggle('hidden', assessments.length > 0);
    assessments.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')).forEach(a => {
      const scores = computeScores(a);
      const cls = scores.headline >= 75 ? 'score-good' : scores.headline >= 40 ? 'score-warn' : 'score-bad';
      const card = document.createElement('div');
      card.className = 'assess-card ' + cls;
      card.innerHTML = `
        <div class="ac-top"><h3>${esc(a.businessName || 'Untitled')}</h3><span class="ac-score">${scores.headline}</span></div>
        <div class="muted" style="font-size:13px;">${esc(a.contactName || '—')}</div>
        <div class="ac-date">${niceDate(a.createdAt)}</div>`;
      card.onclick = () => openAssessment(a.id);
      grid.appendChild(card);
    });
  }
  async function newAssessment() {
    const name = prompt('Business / prospect name:'); if (!name || !name.trim()) return;
    const contact = prompt('Contact name (optional):') || '';
    const payload = fresh(); payload.businessName = name.trim(); payload.contactName = contact.trim();
    const created = await apiSend('/api/diagnostic/assessments', 'POST', payload);
    if (!created) { toast('Could not create assessment'); return; }
    assessments.push(created);
    openAssessment(created.id);
  }
  function openAssessment(id) {
    cur = assessments.find(x => x.id === id); if (!cur) return;
    if (!cur.answers.q) cur.answers.q = {};
    if (!cur.answers.funnel) cur.answers.funnel = { leads: '', booked: '', showed: '', closed: '' };
    if (!cur.answers.ads) cur.answers.ads = { landing: '', qualifies: '', creatives: '', knowsCost: '', platforms: '', cadence: '' };
    $('dashView').classList.add('hidden'); $('reportSection').classList.add('hidden'); $('formView').classList.remove('hidden');
    renderForm();
  }
  async function persist() {
    if (!cur) return;
    const saved = await apiSend('/api/diagnostic/assessments/' + cur.id, 'PUT', cur);
    if (!saved) return;
    cur = saved;
    const idx = assessments.findIndex(x => x.id === cur.id);
    if (idx !== -1) assessments[idx] = cur; else assessments.push(cur);
  }
  async function deleteAssessment() {
    if (!cur || !confirm(`Delete the assessment for ${cur.businessName}? This cannot be undone.`)) return;
    await apiSend('/api/diagnostic/assessments/' + cur.id, 'DELETE', {});
    assessments = assessments.filter(x => x.id !== cur.id); cur = null;
    showDash(); toast('Assessment deleted');
  }
  async function setField(path, value) {
    if (!cur) return;
    const parts = path.split('.'); let obj = cur.answers;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    await persist();
    renderScoreboard();
  }
  async function setQ(qid, val) { await setField('q.' + qid, val); }

  // ── Form rendering ─────────────────────────────────────────────────────────
  function renderForm() {
    const a = cur;
    $('formTitle').textContent = a.businessName || 'Untitled';
    $('formSub').textContent = a.contactName ? `Contact: ${a.contactName}` : '';
    renderScoreboard();

    const host = $('formHost'); host.innerHTML = '';

    // Part A — setup
    host.appendChild(partCard('Part A · Setup', '', `
      <div class="q-block">
        <div class="q-text">What kind of practitioner are you?</div>
        <select id="dg-f-practType" class="q-context">
          <option value="">— Select —</option>
          ${PRACTITIONER_TYPES.map(t => `<option value="${t.v}" ${a.answers.practitionerType === t.v ? 'selected' : ''}>${esc(t.l)}</option>`).join('')}
        </select>
      </div>
      <div class="q-block" id="dg-nurseFlagBlock" style="${a.answers.practitionerType === 'beauty' ? '' : 'display:none'}">
        <div class="q-text">Does a nurse or doctor deliver or oversee any treatment?</div>
        <label class="q-opt" style="max-width:200px"><input type="checkbox" id="dg-f-nurseFlag" ${a.answers.nurseFlag ? 'checked' : ''}> Yes — apply Group A compliance</label>
      </div>
      <div class="q-block">
        <div class="q-text">How long has the business been going?</div>
        <select id="dg-f-businessAge" class="q-context">
          <option value="">— Select —</option>
          <option value="under6" ${a.answers.businessAge === 'under6' ? 'selected' : ''}>Under 6 months</option>
          <option value="6to24" ${a.answers.businessAge === '6to24' ? 'selected' : ''}>6 to 24 months</option>
          <option value="2plus" ${a.answers.businessAge === '2plus' ? 'selected' : ''}>2 years plus</option>
        </select>
      </div>
      <div class="q-block">
        <div class="q-text">Just you, or a team?</div>
        <input id="dg-f-teamSize" class="q-context" value="${esc(a.answers.teamSize)}" placeholder="e.g. Just me">
      </div>
      <div class="q-block">
        <div class="q-text">Are you running paid ads right now, or have you spent on them in the last 90 days?</div>
        <div class="q-options" style="max-width:300px">
          <label class="q-opt"><input type="radio" name="dg-runningAds" value="yes" ${a.answers.runningAds === 'yes' ? 'checked' : ''}> Yes</label>
          <label class="q-opt"><input type="radio" name="dg-runningAds" value="no" ${a.answers.runningAds === 'no' ? 'checked' : ''}> No</label>
        </div>
      </div>
    `));

    // Part B — offer & value
    host.appendChild(partCard('Part B · Offer & Value', 'context — feeds the money math', `
      <div class="q-block"><div class="q-text">Describe your ideal client, in your own words.</div>
        <textarea id="dg-f-idealClient" placeholder="A specific person and problem, not everyone with a body.">${esc(a.answers.idealClient)}</textarea></div>
      <div class="q-block"><div class="q-text">What is your main offer, and what does it cost?</div>
        <textarea id="dg-f-mainOffer">${esc(a.answers.mainOffer)}</textarea></div>
      <div class="row">
        <div class="q-block"><div class="q-text">Average client value, all in ($)</div>
          <input id="dg-f-avgClientValue" type="number" min="0" class="q-context" value="${esc(a.answers.avgClientValue)}" placeholder="Package price, or session price × typical sessions"></div>
        <div class="q-block"><div class="q-text">Active clients now</div>
          <input id="dg-f-activeClients" type="number" min="0" class="q-context" value="${esc(a.answers.activeClients)}"></div>
        <div class="q-block"><div class="q-text">Target new clients / month</div>
          <input id="dg-f-targetNewClients" type="number" min="0" class="q-context" value="${esc(a.answers.targetNewClients)}"></div>
      </div>
    `));

    // Part C — Measure
    host.appendChild(partCard('Part C · Measure', '10 points', `
      ${qBlock('C1')}
      <div class="funnel-inputs">
        <div><label>Leads (last month)</label><input type="number" min="0" id="dg-f-fLeads" value="${esc(a.answers.funnel.leads)}"></div>
        <div><label>Booked</label><input type="number" min="0" id="dg-f-fBooked" value="${esc(a.answers.funnel.booked)}"></div>
        <div><label>Showed</label><input type="number" min="0" id="dg-f-fShowed" value="${esc(a.answers.funnel.showed)}"></div>
        <div><label>Became clients</label><input type="number" min="0" id="dg-f-fClosed" value="${esc(a.answers.funnel.closed)}"></div>
      </div>
      ${qBlock('C2')}${qBlock('C3')}${qBlock('C4')}
    `));

    // Part D — Get found
    host.appendChild(partCard('Part D · Get Found', '40 points', `
      <h4 style="margin:6px 0 4px;">Outreach & Reactivation <span class="muted" style="font-size:12px;">(10 pts)</span></h4>
      ${qBlock('D2')}${qBlock('D3')}${qBlock('D4')}
      <h4 style="margin:16px 0 4px;">Referrals <span class="muted" style="font-size:12px;">(4 pts)</span></h4>
      ${qBlock('D5')}${qBlock('D6')}
      <h4 style="margin:16px 0 4px;">Reviews & Google <span class="muted" style="font-size:12px;">(9 pts)</span></h4>
      ${qBlock('D7')}${qBlock('D8')}${qBlock('D9')}${qBlock('D10')}${qBlock('D11')}
      <h4 style="margin:16px 0 4px;">Website <span class="muted" style="font-size:12px;">(8 pts)</span></h4>
      ${qBlock('D12')}${qBlock('D13')}${qBlock('D14')}${qBlock('D15')}
      <h4 style="margin:16px 0 4px;">Directories <span class="muted" style="font-size:12px;">(4 pts)</span></h4>
      ${qBlock('D16')}${qBlock('D17')}
      <h4 style="margin:16px 0 4px;">Content & Social <span class="muted" style="font-size:12px;">(5 pts)</span></h4>
      ${qBlock('D18')}${qBlock('D19')}${qBlock('D20')}
    `));

    // Part E — Capture
    host.appendChild(partCard('Part E · Capture Interest', '15 points', `${qBlock('E1')}${qBlock('E2')}${qBlock('E3')}${qBlock('E4')}`));

    // Part F — Sell
    host.appendChild(partCard('Part F · Sell', '35 points', `
      <h4 style="margin:6px 0 4px;">Speed to Reply <span class="muted" style="font-size:12px;">(10 pts)</span></h4>
      ${qBlock('F1')}${qBlock('F2')}
      <h4 style="margin:16px 0 4px;">Follow-up <span class="muted" style="font-size:12px;">(10 pts)</span></h4>
      ${qBlock('F3')}${qBlock('F4')}${qBlock('F5')}
      <h4 style="margin:16px 0 4px;">Show Rate <span class="muted" style="font-size:12px;">(7 pts)</span></h4>
      ${qBlock('F6')}${qBlock('F7')}
      <h4 style="margin:16px 0 4px;">Sales Conversation <span class="muted" style="font-size:12px;">(8 pts)</span></h4>
      ${qBlock('F8')}${qBlock('F9')}${qBlock('F10')}
    `));

    // Part G — Ads (conditional)
    if (a.answers.runningAds === 'yes') {
      host.appendChild(partCard('Part G · Paid Ads', 'unscored — audited separately', `
        <div class="q-block"><div class="q-text">Where does ad traffic land?</div><input id="dg-f-adsLanding" class="q-context" value="${esc(a.answers.ads.landing)}" placeholder="Instant form / landing page / homepage"></div>
        <div class="q-block"><div class="q-text">Does the form qualify anyone out?</div><input id="dg-f-adsQualifies" class="q-context" value="${esc(a.answers.ads.qualifies)}"></div>
        <div class="q-block"><div class="q-text">How many genuinely different creative angles are live right now?</div><input id="dg-f-adsCreatives" class="q-context" value="${esc(a.answers.ads.creatives)}"></div>
        <div class="q-block"><div class="q-text">Do you know cost per lead, per booked consult, per client?</div><input id="dg-f-adsKnowsCost" class="q-context" value="${esc(a.answers.ads.knowsCost)}"></div>
        <div class="q-block"><div class="q-text">What platforms and budget? Is Google search on for your name and service terms?</div><input id="dg-f-adsPlatforms" class="q-context" value="${esc(a.answers.ads.platforms)}"></div>
        <div class="q-block"><div class="q-text">How long does an ad run before you change it?</div><input id="dg-f-adsCadence" class="q-context" value="${esc(a.answers.ads.cadence)}"></div>
      `));
    }

    // Part H — Close
    host.appendChild(partCard('Part H · Close', '', `
      <div class="q-block"><div class="q-text">Before pulling this together — what feels like the biggest gap to you?</div>
        <textarea id="dg-f-biggestGap">${esc(a.answers.biggestGap)}</textarea></div>
    `));

    // Wire up events
    $('f-practType').onchange = e => { setField('practitionerType', e.target.value); document.getElementById('dg-nurseFlagBlock').style.display = e.target.value === 'beauty' ? '' : 'none'; };
    const nurseEl = document.getElementById('dg-f-nurseFlag'); if (nurseEl) nurseEl.onchange = e => setField('nurseFlag', e.target.checked);
    $('f-businessAge').onchange = e => setField('businessAge', e.target.value);
    $('f-teamSize').onchange = e => setField('teamSize', e.target.value);
    document.querySelectorAll('input[name="dg-runningAds"]').forEach(el => el.onchange = e => { setField('runningAds', e.target.value); renderForm(); });
    $('f-idealClient').onchange = e => setField('idealClient', e.target.value);
    $('f-mainOffer').onchange = e => setField('mainOffer', e.target.value);
    $('f-avgClientValue').onchange = e => setField('avgClientValue', e.target.value);
    $('f-activeClients').onchange = e => setField('activeClients', e.target.value);
    $('f-targetNewClients').onchange = e => setField('targetNewClients', e.target.value);
    $('f-fLeads').onchange = e => setField('funnel.leads', e.target.value);
    $('f-fBooked').onchange = e => setField('funnel.booked', e.target.value);
    $('f-fShowed').onchange = e => setField('funnel.showed', e.target.value);
    $('f-fClosed').onchange = e => setField('funnel.closed', e.target.value);
    $('f-biggestGap').onchange = e => setField('biggestGap', e.target.value);
    const adsIds = ['adsLanding', 'adsQualifies', 'adsCreatives', 'adsKnowsCost', 'adsPlatforms', 'adsCadence'];
    adsIds.forEach(id => { const el = $('f-' + id); if (el) el.onchange = e => setField('ads.' + id.replace('ads', '').replace(/^./, c => c.toLowerCase()), e.target.value); });
    Object.keys(Q).forEach(qid => {
      document.querySelectorAll(`input[name="dg-q-${qid}"]`).forEach(el => el.onchange = e => setQ(qid, e.target.value === 'na' ? 'na' : Number(e.target.value)));
    });
  }
  function partCard(title, pts, bodyHtml) {
    const div = document.createElement('div'); div.className = 'part-card';
    div.innerHTML = `<div class="part-head"><h3>${esc(title)}</h3><span class="part-pts">${esc(pts)}</span></div><div class="part-body">${bodyHtml}</div>`;
    return div;
  }
  function qBlock(qid) {
    const q = Q[qid]; const val = cur.answers.q[qid];
    return `<div class="q-block">
      <div class="q-text">${esc(qid)}. ${esc(q.text)}</div>
      ${q.sub ? `<div class="q-sub">${esc(q.sub)}</div>` : ''}
      <div class="q-options">
        ${q.options.map(o => `<label class="q-opt"><input type="radio" name="dg-q-${qid}" value="${o.v}" ${String(val) === String(o.v) ? 'checked' : ''}><span>${esc(o.l)}</span></label>`).join('')}
      </div>
    </div>`;
  }

  function renderScoreboard() {
    const a = cur; if (!a) return;
    const scores = computeScores(a);
    $('headlineNum').innerHTML = `${scores.headline}<small> / 100</small>`;
    $('jobBars').innerHTML = Object.entries(JOBS).map(([key, job]) => {
      const s = scores.jobs[key]; const pct = s.max ? s.score / s.max * 100 : 0;
      const cls = pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad';
      return `<div class="job-bar">
        <div class="jb-track"><div class="jb-fill ${cls}" style="height:${Math.max(3, pct)}%"></div></div>
        <div class="jb-val">${s.score}/${s.max}</div>
        <div class="jb-label">${esc(job.label)}</div>
      </div>`;
    }).join('');
    $('chipRow').innerHTML = SECTIONS.map(sec => {
      const s = scores.sections[sec.key];
      return `<span class="chip ${s.chip}">${esc(sec.label)}: ${chipLabel(s.chip)}</span>`;
    }).join('');
  }

  // ── Printable strategy report ──────────────────────────────────────────────
  function showReport() {
    const a = cur; const scores = computeScores(a); const rec = computeRecommendation(a, scores);
    const { ltv, gltv } = ltvMath(a);
    const group = CONFIG_GROUPS[rec.group];
    const funnel = rec.funnel;

    const jobPageHtml = (title, activeKeys, passiveKeys) => {
      const col = (keys, label) => keys.length ? `<div class="job-page-col"><h4>${label}</h4>${keys.map(k => {
        const sec = SECTIONS.find(s => s.key === k); const s = scores.sections[k];
        return `<div style="margin-bottom:8px;"><span class="chip ${s.chip}">${esc(sec.label)}: ${chipLabel(s.chip)}</span></div>`;
      }).join('')}</div>` : '';
      return `<div class="report-section"><h2>${esc(title)}</h2><div class="job-page">${col(activeKeys, 'Active')}${col(passiveKeys, 'Passive / foundational')}</div></div>`;
    };

    const funnelRow = (label, val, floor, healthy) => {
      if (val == null) return `<tr><td>${label}</td><td colspan="2" class="muted">No data yet</td></tr>`;
      const cls = val < floor ? 'low' : 'ok';
      return `<tr><td>${label}</td><td class="${cls}">${Math.round(val)}%</td><td class="muted">floor ${floor}%${healthy ? `, healthy ${healthy}%+` : ''}</td></tr>`;
    };

    const actionsHtml = rec.actions.map(act => `
      <div class="plan-action">
        <div class="pa-title">${esc(act.title)}</div>
        <div class="pa-dll"><strong>Done looks like:</strong> ${esc(act.doneLooksLike)}</div>
        <div class="pa-page">${esc(act.pageRef)}</div>
      </div>`).join('') || '<p class="muted">No specific gaps flagged — steady as she goes.</p>';

    const quickWinsHtml = rec.quickWins.length ? `
      <div class="report-section"><h2>Quick wins</h2><p class="muted" style="margin-bottom:10px;">Cheap, same-day items, independent of the main priority.</p>
      ${rec.quickWins.map(qw => `<div class="plan-action"><div class="pa-title">${esc(qw.title)}</div><div class="pa-dll">${esc(qw.doneLooksLike)}</div></div>`).join('')}
      </div>` : '';

    const html = `
      <div class="report-masthead">
        <div><div class="wm">GATHR <span>GROW</span></div><div class="sub">The Scoreboard — Strategy Report</div></div>
        <div class="report-for"><div class="c-name">${esc(a.businessName)}</div><div class="c-date">${niceDate(a.createdAt)}</div></div>
      </div>

      <div class="report-section">
        <h2>Every business does three jobs</h2>
        <p>Get found, capture interest, and sell. In the real world these show up as leads, booked, showed and closed. This scorecard shows how well ${esc(a.businessName)} is doing each job today, then gives a plan for the next 30 days.</p>
      </div>

      <div class="report-section">
        <h2>Your score</h2>
        <div class="headline-score">
          <div class="headline-num">${scores.headline}<small> / 100</small></div>
          <div class="headline-anchor">Healthy practices sit at 75 or higher. This score updates every time we re-run the scorecard together.</div>
        </div>
        <div class="job-bars">${Object.entries(JOBS).map(([key, job]) => {
          const s = scores.jobs[key]; const pct = s.max ? s.score / s.max * 100 : 0;
          const cls = pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad';
          return `<div class="job-bar"><div class="jb-track"><div class="jb-fill ${cls}" style="height:${Math.max(3, pct)}%"></div></div><div class="jb-val">${s.score}/${s.max}</div><div class="jb-label">${esc(job.label)}</div></div>`;
        }).join('')}</div>
      </div>

      ${jobPageHtml('Get Found', GETFOUND_ACTIVE, GETFOUND_PASSIVE)}
      ${jobPageHtml('Capture Interest', ['capture'], [])}
      ${jobPageHtml('Sell', ['speed', 'followup', 'show', 'sales'], [])}

      <div class="report-section">
        <h2>How this is measured</h2>
        <table class="funnel-table">
          <thead><tr><th>Stage</th><th>Your rate</th><th>Benchmark</th></tr></thead>
          <tbody>
            <tr><td>Leads (last month)</td><td colspan="2">${funnel.leads || '—'}</td></tr>
            ${funnelRow('Booked', funnel.bookPct, 60)}
            ${funnelRow('Showed', funnel.showPct, 60, 70)}
            ${funnelRow('Closed', funnel.closePct, 30, 35)}
          </tbody>
        </table>
      </div>

      <div class="report-section">
        <h2>What a client is worth to you</h2>
        <div class="ltv-box">
          <div class="ltv-stat"><div class="lv-lbl">Client value (LTV)</div><div class="lv-val">$${ltv ? ltv.toLocaleString() : '—'}</div></div>
          <div class="ltv-stat"><div class="lv-lbl">Max profitable cost to buy a client (GLTV)</div><div class="lv-val">$${gltv ? Math.round(gltv).toLocaleString() : '—'}</div></div>
        </div>
        <p class="muted" style="margin-top:10px; font-size:12.5px;">GLTV assumes roughly 30% margin comes out before you count it as profit. Anything you pay to acquire a client under this number is a profitable trade.</p>
      </div>

      <div class="report-section plan-priority">
        <h3>Next 30 days: ${esc(rec.priorityLabel)}</h3>
        <p>${esc(rec.priorityBlurb)}</p>
        ${actionsHtml}
      </div>
      ${quickWinsHtml}

      <div class="report-section">
        <h2>How we can help</h2>
        <div class="close-options">
          <div class="close-option"><h4>Do it yourself</h4><p style="font-size:13.5px;">Everything above is in the free guide we're sending along with this report. Work through the priority action first.</p></div>
          <div class="close-option"><h4>Here's what we'd do</h4><p style="font-size:13.5px;">Based on where you're at, our <strong>${esc(rec.service)}</strong> program is the fastest path to closing this gap.</p></div>
        </div>
        ${group ? `<p class="muted" style="margin-top:14px; font-size:12px;"><strong>${esc(group.label)}:</strong> ${esc(group.compliance)}</p>` : ''}
      </div>

      <div class="report-footer"><div>Prepared by Gathr Grow · gathrspace.com.au</div><div>309 George Street, Sydney CBD</div></div>
    `;
    $('reportInner').innerHTML = html;
    $('formView').classList.add('hidden'); $('reportSection').classList.remove('hidden');
    document.getElementById('tab-diagnostic')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  function backToForm() { $('reportSection').classList.add('hidden'); $('formView').classList.remove('hidden'); }

  window.Diagnostic = {
    onOpen, showDash, newAssessment, openAssessment, deleteAssessment, showReport, backToForm,
  };
})();
