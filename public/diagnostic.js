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
    C_LTV: { text: 'Did they know their client LTV?', max: 2,
      options: [{ v: 2, l: '2 · Yes, confidently' }, { v: 1, l: '1 · Can figure it out with estimates' }, { v: 0, l: '0 · No' }] },
    C_LEADSKNOWN: { text: 'Did they know their lead count without having to think hard?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_BOOKEDKNOWN: { text: 'Did they know how many booked without having to think hard?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_SHOWEDKNOWN: { text: 'Did they know how many showed without having to think hard?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_CLOSEDKNOWN: { text: 'Did they know how many they closed without having to think hard?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_HEARD: { text: 'Do you ask every new client how they heard about you, and document it somewhere?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_REASONSNO: { text: 'Do you track the reasons clients say no to you?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_TRAFFIC: { text: 'Do you track the traffic on your landing page or website?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },
    C_OPTIN: { text: 'Do you track the opt-in rate on your landing page or website?', max: 1,
      options: [{ v: 1, l: '1 · Yes' }, { v: 0, l: '0 · No' }] },

    D_ADS: { text: 'Are you running paid ads, and are they reliably producing leads?',
      options: [{ v: 2, l: '2 · Yes, running and reliably producing leads' }, { v: 1, l: '1 · Running, but inconsistent or unclear results' }, { v: 0, l: '0 · Not running, or running and producing nothing' }, { v: 'na', l: 'N/A · Not running ads' }] },

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
    { key: 'measure', label: 'Measure', weight: 10, job: 'measure', qids: ['C_LTV', 'C_LEADSKNOWN', 'C_BOOKEDKNOWN', 'C_SHOWEDKNOWN', 'C_CLOSEDKNOWN', 'C_HEARD', 'C_REASONSNO', 'C_TRAFFIC', 'C_OPTIN'] },
    // Get Found — Active (20 pts) and Passive (20 pts). Sub-weights below are an
    // even placeholder split pending the finalised breakdown for Part D.
    { key: 'content', label: 'Creating Content', weight: 7, job: 'getfound', qids: ['D18', 'D19', 'D20'] },
    { key: 'paidads', label: 'Paid Ads', weight: 7, job: 'getfound', qids: ['D_ADS'] },
    { key: 'outreach', label: 'Outreach', weight: 6, job: 'getfound', qids: ['D2', 'D3', 'D4'] },
    { key: 'referrals', label: 'Referrals', weight: 5, job: 'getfound', qids: ['D5', 'D6'] },
    { key: 'reviews', label: 'Social Proof / Reviews', weight: 5, job: 'getfound', qids: ['D7', 'D8', 'D9', 'D10', 'D11'] },
    { key: 'website', label: 'Website', weight: 5, job: 'getfound', qids: ['D12', 'D13', 'D14', 'D15'] },
    { key: 'directories', label: 'Directory Listings', weight: 5, job: 'getfound', qids: ['D16', 'D17'] },
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
  const GETFOUND_ACTIVE = ['content', 'paidads', 'outreach'];
  const GETFOUND_PASSIVE = ['referrals', 'reviews', 'website', 'directories'];

  // The playbook: for every scored channel, why a low score usually happens,
  // the specific free thing they can do about it (the "quick win"), and the
  // Gathr service that closes the gap for them. Feeds the combined Quick
  // Wins + 30-Day playbook section of the report — grouped by Strong/Needs
  // work/Missing, then Active/Passive within Get Found.
  const CHANNEL_META = {
    content: { group: 'active',
      why: 'Posting inconsistently means you disappear from feeds between posts, and the algorithm stops showing you to new people.',
      quickWin: 'Post 3 short videos this week answering real questions your clients actually ask — no editing required.',
      service: 'Content', serviceBlurb: 'We plan, film and edit a month of content for you.' },
    paidads: { group: 'active',
      why: "Ads without a working website and follow-up in place just burn budget on leads nobody actions.",
      quickWin: 'If your foundation is not ready, pause ads for now — save the budget until leads can actually convert.',
      service: 'Ads Management', serviceBlurb: 'We build the funnel first, then run and optimise your ads.' },
    outreach: { group: 'active',
      why: "Past clients and your warm network do not know you are taking on new clients right now — silence reads as unavailable.",
      quickWin: 'Message 10 past or lapsed clients today with a genuine check-in, not a pitch.',
      service: 'Software Setup', serviceBlurb: 'We build your reactivation and referral-ask sequences.' },
    referrals: { group: 'passive',
      why: "If you never ask, happy clients assume you do not need more — referrals need a specific, well-timed ask.",
      quickWin: 'Ask your next 3 happy clients for an introduction to someone specific, not just "tell your friends."',
      service: 'Software Setup', serviceBlurb: 'We build a referral-ask system triggered at the right moment.' },
    reviews: { group: 'passive',
      why: 'A thin or inconsistent Google profile with few recent reviews makes you invisible against competitors who show up first.',
      quickWin: 'Send your last 5 happy clients your Google review link today.',
      service: 'Software Setup', serviceBlurb: 'We set up your profile properly and build an always-on review-ask flow.' },
    website: { group: 'passive',
      why: 'A slow site, a buried call-to-action, or a vague headline loses visitors before they see what you offer.',
      quickWin: 'Add one clear button above the fold: "Book now" or "Get started."',
      service: 'Software Setup', serviceBlurb: 'We build a fast, clear, mobile-first website.' },
    directories: { group: 'passive',
      why: 'Missing or inconsistent directory listings mean you are invisible on the exact platforms your ideal clients search.',
      quickWin: 'List your business on the 2-3 directories that matter most for your profession today — most are free.',
      service: 'Software Setup', serviceBlurb: 'We audit and set up every directory that matters for your type.' },
    capture: { group: null,
      why: 'Sending traffic to a generic page or a long form loses interested people before they become a lead.',
      quickWin: 'Build one simple, focused landing page for your main offer this week — even a single page with a short form.',
      service: 'Software Setup', serviceBlurb: 'We build a focused capture page and shorten your form to convert more.' },
    speed: { group: null,
      why: 'The first business to reply usually wins the client — every hour of delay loses leads to a faster competitor.',
      quickWin: 'Turn on phone notifications and reply to every new lead within 5 minutes today.',
      service: 'Brand OS', serviceBlurb: 'We set up instant auto-replies and lead alerts.' },
    followup: { group: null,
      why: 'Most leads do not buy on the first touch — stopping after one or two attempts leaves easy sales on the table.',
      quickWin: 'Pick 3 leads who went quiet and follow up today, on a different channel than last time.',
      service: 'Brand OS', serviceBlurb: 'We build a 5-to-8-touch follow-up sequence across call, text and email.' },
    show: { group: null,
      why: 'Bookings made too far out, with no reminders, means people simply forget or deprioritise the appointment.',
      quickWin: 'Send a text reminder the day before every booked call this week.',
      service: 'Brand OS', serviceBlurb: 'We set up automatic reminders and a one-tap reschedule flow.' },
    sales: { group: null,
      why: 'Without a clear structure or a direct ask, good conversations end in "let me think about it" instead of a decision.',
      quickWin: 'On your next call, end with a direct ask: "Here’s what I recommend, how does that sit with you?"',
      service: 'Brand OS', serviceBlurb: 'We script and train your team on a simple, repeatable sales conversation.' },
  };
  // Same "what good looks like" bullets shown on each channel's education
  // slide, reused inside the playbook's "Best practices" block per channel.
  const CHANNEL_BULLETS = {
    content: ['Post short, useful videos a few times a week.', 'Answer the real questions clients ask.', 'Hold attention, do not just chase views.', 'Always point people to a next step.', 'Reuse your best pieces as proof.'],
    paidads: ['Start once your website and follow-up work.', 'One clear offer, sent to one landing page.', 'Let the creative do the work, not the budget.', 'Judge ads on cost per booked client.', 'Give each ad time before you change it.'],
    outreach: ['Start warm: people who already know you.', 'Lead with something useful, not a pitch.', 'Personalise every message. No mass blasts.', 'Ask past and lapsed clients to come back.', 'Keep it friendly, and stop if they ask.'],
    referrals: ['Ask happy clients at their best moment.', 'Ask for an introduction, not just a name.', 'Build steady links with GPs and partners.', 'Make it easy, and thank them each time.', 'Follow the rules for your profession.'],
    reviews: ['Fill in your Google profile completely.', 'Keep it active with posts and photos.', 'Ask happy clients for a fresh review often.', 'Reply to every review.', 'Keep your name, address and phone the same everywhere.'],
    website: ['A simple, fast site with one clear next step.', 'One page for each service you offer.', 'Use the plain words people search for.', 'Add your details so AI can read them.', 'Works well on a phone.'],
    directories: ['List on the directories for your profession.', 'Many are free with your membership.', 'Keep every listing the same.', 'Point each one back to your website.'],
    capture: ['Send campaign traffic to one focused landing page.', 'One page, one action, no other links.', 'Offer a valuable first step, like a named assessment.', 'Not just a "free consult".', 'Keep the form short.', 'Reply the moment a lead arrives.'],
    speed: ['Reply to every new lead within 5 minutes.', 'If you cannot call, send a text.', 'Ask a question to start a conversation.', 'The first to reply usually wins.'],
    followup: ['Follow up 5 to 8 times, not once.', 'Use call, text, and email.', 'Space it over 2 to 3 weeks.', 'End with a clear last message.', 'Stay friendly, never pushy.'],
    show: ['Book calls within 3 to 4 days.', 'Send reminders by text and email.', 'Ask them to reply to confirm.', 'Make it easy to rebook.'],
    sales: ['Set the plan for the call up front.', 'Understand their problem and their goal.', 'Ask for the sale, clearly.', 'Have a smaller first step ready.', 'Keep it helpful, not pushy.'],
  };

  function fresh() {
    return {
      businessName: '', contactName: '', createdAt: todayStr(),
      answers: {
        practitionerType: '', nurseFlag: false, businessAge: '', teamSize: '', servesArea: '', runningAds: '',
        idealClient: '', mainOffer: '', avgClientValue: '', activeClients: '', targetNewClients: '', targetDate: '',
        funnel: { leads: '', booked: '', showed: '', closed: '' },
        outreachReachCount: '', ranEvents: '',
        biggestGap: '',
        ads: { landing: '', qualifies: '', creatives: '', knowsCost: '', platforms: '', cadence: '' },
        // Free-text notes at the bottom of each part — the team's own
        // observations/recommendations while running the session live,
        // not a client-facing question. Surfaced in the report's Special
        // Notes section.
        partNotes: { context: '', wig: '', measure: '', getfound: '', capture: '', sell: '' },
        q: {}, // scored question answers, keyed by question id
      },
    };
  }

  // ── Scoring ────────────────────────────────────────────────────────────────
  function sectionScore(a, sec) {
    let earned = 0, applicableRaw = 0, maxRaw = 0;
    sec.qids.forEach(qid => {
      const qmax = Q[qid].max || 2;
      maxRaw += qmax;
      const v = a.answers.q[qid];
      if (v === undefined || v === null || v === '' || v === 'na') return;
      applicableRaw += qmax;
      earned += Number(v);
    });
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
    if (sectionKey === 'paidads') return 'Ads Management';
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
    const cantMeasure = !funnel.hasData;
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
    if (!cur.answers.partNotes) cur.answers.partNotes = { context: '', wig: '', measure: '', getfound: '', capture: '', sell: '' };
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

    // Part A — Context
    host.appendChild(partCard('Part A · Context', '', `
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
    `, 'context'));

    // Part B — WIG
    const ltvVal = Number(a.answers.avgClientValue) || 0;
    host.appendChild(partCard('Part B · WIG', 'the wildly important goal — feeds the money math', `
      <div class="q-block"><div class="q-text">Describe your ideal client, in your own words.</div>
        <textarea id="dg-f-idealClient" placeholder="A specific person and problem, not everyone with a body.">${esc(a.answers.idealClient)}</textarea></div>
      <div class="q-block"><div class="q-text">What is your main offer, and what does it cost?</div>
        <textarea id="dg-f-mainOffer">${esc(a.answers.mainOffer)}</textarea></div>
      <div class="row">
        <div class="q-block"><div class="q-text">Client LTV ($)</div>
          <input id="dg-f-avgClientValue" type="number" min="0" class="q-context" value="${esc(a.answers.avgClientValue)}" placeholder="Package price, or session price × typical sessions"></div>
        <div class="q-block"><div class="q-text">Gross LTV</div>
          <div class="q-context" id="dg-gltvDisplay" style="background:var(--dg-lightgrey); border-radius:3px; padding:8px 10px;">$${Math.round(ltvVal * 0.7).toLocaleString()}</div>
          <div class="q-sub">Calculated — 70% of client LTV.</div></div>
      </div>
      <div class="row">
        <div class="q-block"><div class="q-text">Current number of active clients</div>
          <input id="dg-f-activeClients" type="number" min="0" class="q-context" value="${esc(a.answers.activeClients)}"></div>
        <div class="q-block"><div class="q-text">Target number of clients</div>
          <input id="dg-f-targetNewClients" type="number" min="0" class="q-context" value="${esc(a.answers.targetNewClients)}"></div>
        <div class="q-block"><div class="q-text">By what date</div>
          <input id="dg-f-targetDate" type="date" class="q-context" value="${esc(a.answers.targetDate)}"></div>
      </div>
    `, 'wig'));

    // Part C — Measurement
    host.appendChild(partCard('Part C · Measurement', '10 points', `
      ${qBlock('C_LTV')}
      ${funnelKnownBlock('How many leads did you get last month?', 'fLeads', 'funnel.leads', a.answers.funnel.leads, 'C_LEADSKNOWN')}
      ${funnelKnownBlock('How many booked to speak to you?', 'fBooked', 'funnel.booked', a.answers.funnel.booked, 'C_BOOKEDKNOWN')}
      ${funnelKnownBlock('How many showed?', 'fShowed', 'funnel.showed', a.answers.funnel.showed, 'C_SHOWEDKNOWN')}
      ${funnelKnownBlock('How many did you close?', 'fClosed', 'funnel.closed', a.answers.funnel.closed, 'C_CLOSEDKNOWN')}
      ${qBlock('C_HEARD')}${qBlock('C_REASONSNO')}${qBlock('C_TRAFFIC')}${qBlock('C_OPTIN')}
    `, 'measure'));

    // Part D — Get Found (Active 20 / Passive 20)
    host.appendChild(partCard('Part D · Get Found', '40 points — Active 20, Passive 20', `
      <h4 style="margin:6px 0 4px;">Active <span class="muted" style="font-size:12px;">(20 pts)</span></h4>
      <div class="q-sub" style="margin-top:-2px;">Creating content, paid ads, and outreach — things you have to actively do.</div>
      <h4 style="margin:14px 0 4px; font-size:13px;">Creating Content</h4>
      ${qBlock('D18')}${qBlock('D19')}${qBlock('D20')}
      <h4 style="margin:14px 0 4px; font-size:13px;">Paid Ads</h4>
      ${qBlock('D_ADS')}
      <h4 style="margin:14px 0 4px; font-size:13px;">Outreach</h4>
      <div class="q-block">
        <div class="q-text">How many people could you reach out to right now to offer a free session?</div>
        <input type="number" min="0" id="dg-f-outreachReachCount" class="q-inline-num" value="${esc(a.answers.outreachReachCount)}">
      </div>
      ${qBlock('D2')}${qBlock('D3')}${qBlock('D4')}

      <h4 style="margin:20px 0 4px;">Passive <span class="muted" style="font-size:12px;">(20 pts)</span></h4>
      <div class="q-sub" style="margin-top:-2px;">Referrals, social proof, website and directory listings — set up once, work in the background.</div>
      <h4 style="margin:14px 0 4px; font-size:13px;">Referrals</h4>
      ${qBlock('D5')}${qBlock('D6')}
      <h4 style="margin:14px 0 4px; font-size:13px;">Social Proof / Reviews</h4>
      ${qBlock('D7')}${qBlock('D8')}${qBlock('D9')}${qBlock('D10')}${qBlock('D11')}
      <h4 style="margin:14px 0 4px; font-size:13px;">Your Website</h4>
      ${qBlock('D12')}${qBlock('D13')}${qBlock('D14')}${qBlock('D15')}
      <h4 style="margin:14px 0 4px; font-size:13px;">Directory Listings</h4>
      ${qBlock('D16')}${qBlock('D17')}
    `, 'getfound'));

    // Part E — Capture
    host.appendChild(partCard('Part E · Capture Interest', '15 points', `${qBlock('E1')}${qBlock('E2')}${qBlock('E3')}${qBlock('E4')}`, 'capture'));

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
    `, 'sell'));

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

    // Wire up events. `on()` is defensive on purpose: a single missing/
    // mismatched id must never throw and silently kill every wiring line
    // after it (that exact bug once broke every scored question on the form).
    const on = (id, handler) => { const el = $(id); if (el) el.onchange = handler; else console.warn('[Diagnostic] missing form field: dg-' + id); };
    on('f-practType', e => { setField('practitionerType', e.target.value); const b = document.getElementById('dg-nurseFlagBlock'); if (b) b.style.display = e.target.value === 'beauty' ? '' : 'none'; });
    on('f-nurseFlag', e => setField('nurseFlag', e.target.checked));
    on('f-businessAge', e => setField('businessAge', e.target.value));
    on('f-teamSize', e => setField('teamSize', e.target.value));
    document.querySelectorAll('input[name="dg-runningAds"]').forEach(el => el.onchange = e => { setField('runningAds', e.target.value); renderForm(); });
    on('f-idealClient', e => setField('idealClient', e.target.value));
    on('f-mainOffer', e => setField('mainOffer', e.target.value));
    on('f-avgClientValue', e => { setField('avgClientValue', e.target.value); const g = document.getElementById('dg-gltvDisplay'); if (g) g.textContent = '$' + Math.round((Number(e.target.value) || 0) * 0.7).toLocaleString(); });
    on('f-activeClients', e => setField('activeClients', e.target.value));
    on('f-targetNewClients', e => setField('targetNewClients', e.target.value));
    on('f-targetDate', e => setField('targetDate', e.target.value));
    on('f-outreachReachCount', e => setField('outreachReachCount', e.target.value));
    on('f-fLeads', e => setField('funnel.leads', e.target.value));
    on('f-fBooked', e => setField('funnel.booked', e.target.value));
    on('f-fShowed', e => setField('funnel.showed', e.target.value));
    on('f-fClosed', e => setField('funnel.closed', e.target.value));
    on('f-biggestGap', e => setField('biggestGap', e.target.value));
    ['context', 'wig', 'measure', 'getfound', 'capture', 'sell'].forEach(key => {
      on('f-notes-' + key, e => setField('partNotes.' + key, e.target.value));
    });
    const adsIds = ['adsLanding', 'adsQualifies', 'adsCreatives', 'adsKnowsCost', 'adsPlatforms', 'adsCadence'];
    adsIds.forEach(id => on('f-' + id, e => setField('ads.' + id.replace('ads', '').replace(/^./, c => c.toLowerCase()), e.target.value)));
    Object.keys(Q).forEach(qid => {
      document.querySelectorAll(`input[name="dg-q-${qid}"]`).forEach(el => el.onchange = e => setQ(qid, e.target.value === 'na' ? 'na' : Number(e.target.value)));
    });
  }
  function partCard(title, pts, bodyHtml, notesKey) {
    const div = document.createElement('div'); div.className = 'part-card';
    div.innerHTML = `<div class="part-head"><h3>${esc(title)}</h3><span class="part-pts">${esc(pts)}</span></div>
      <div class="part-body">${bodyHtml}${notesKey ? notesBlock(notesKey) : ''}</div>`;
    return div;
  }
  // A free-text notes field at the bottom of a part — the team's own
  // observations or recommendations while running the session live, not
  // a client-facing question. Feeds the report's Special Notes section.
  function notesBlock(key) {
    return `<div class="q-block dg-notes-block">
      <div class="q-text">Notes &amp; recommendations</div>
      <div class="q-sub">Your own observations for this part — shown in the report's Special Notes section.</div>
      <textarea id="dg-f-notes-${key}" placeholder="e.g. Client mentioned wanting to raise prices next quarter...">${esc(cur.answers.partNotes[key] || '')}</textarea>
    </div>`;
  }
  function qBlock(qid) {
    const q = Q[qid]; const val = cur.answers.q[qid];
    return `<div class="q-block">
      <div class="q-text">${esc(q.text)}</div>
      ${q.sub ? `<div class="q-sub">${esc(q.sub)}</div>` : ''}
      <div class="q-options">
        ${q.options.map(o => `<label class="q-opt"><input type="radio" name="dg-q-${qid}" value="${o.v}" ${String(val) === String(o.v) ? 'checked' : ''}><span>${esc(o.l)}</span></label>`).join('')}
      </div>
    </div>`;
  }
  // Number entry (the actual funnel count) paired with a Yes/No "did they know
  // this without having to think about it" toggle, worth 1 point.
  function funnelKnownBlock(label, numFieldId, numPath, numVal, qid) {
    const val = cur.answers.q[qid];
    return `<div class="q-block">
      <div class="q-text">${esc(label)}</div>
      <div class="row" style="align-items:flex-end;">
        <div style="max-width:140px;"><label>Number</label><input type="number" min="0" id="dg-f-${numFieldId}" value="${esc(numVal)}"></div>
        <div>
          <label>Did they know this straight away?</label>
          <div class="q-options">
            ${Q[qid].options.map(o => `<label class="q-opt"><input type="radio" name="dg-q-${qid}" value="${o.v}" ${String(val) === String(o.v) ? 'checked' : ''}><span>${esc(o.l)}</span></label>`).join('')}
          </div>
        </div>
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

  // ── Printable strategy report — a flowing document ────────────────────────
  // Same content and copy as the "Your Marketing Strategy" reference deck,
  // but read top to bottom as one document. Each channel is a single
  // self-contained card: a title, one status badge (Strong / Needs work /
  // Missing), what good looks like, a free 30-day quick win, and what we
  // can help with — no separate education pass and playbook pass, no
  // notes area. Cards sit inside a light, colour-coded band per
  // job/category so Active vs Passive (and Get Found vs Capture vs Sell)
  // read clearly at a glance.
  function docBanner(eyebrow, title, sub, jobBanner) {
    return `<div class="doc-banner${jobBanner ? ' job-banner' : ''}">
      ${eyebrow ? `<div class="eyebrow-sm">${esc(eyebrow)}</div>` : ''}
      <h1 class="slide-title">${esc(title)}</h1>
      ${sub ? `<div class="slide-sub">${esc(sub)}</div>` : ''}
    </div>`;
  }
  // One card per channel. sectionKey drives the status badge and (via
  // CHANNEL_META) the quick win / help blocks; channels with no score
  // yet (or that score Strong) skip the quick-win/help blocks and show
  // just the badge and what-good-looks-like reference.
  function channelCard(title, sectionKey, bullets, scores, quickWinOverride) {
    const s = sectionKey ? scores.sections[sectionKey] : null;
    const chip = s ? s.chip : null;
    const badgeCls = chip === 'strong' ? 'strong' : chip === 'needswork' ? 'needswork' : chip ? 'missing' : null;
    const showGap = badgeCls && badgeCls !== 'strong';
    const meta = sectionKey ? CHANNEL_META[sectionKey] : null;
    const quickWin = quickWinOverride || meta?.quickWin;
    return `<div class="ch-card">
      <div class="ch-card-head">
        <h3>${esc(title)}</h3>
        ${badgeCls ? `<span class="ch-badge ${badgeCls}">${esc(chipLabel(chip))}</span>` : ''}
      </div>
      <div class="ch-block"><h4>What good looks like</h4><ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>
      ${showGap && meta ? `
      <div class="ch-block"><h4>Quick win &mdash; free, next 30 days</h4><p>${esc(quickWin)}</p></div>
      <div class="ch-block ch-help"><h4>What we can help with</h4><p>${esc(meta.serviceBlurb)} <span style="color:var(--dg-orange)">(${esc(meta.service)})</span></p></div>` : ''}
    </div>`;
  }
  function docGroup(cls, title, cardsHtml) {
    return `<div class="doc-group ${cls}">
      ${title ? `<div class="doc-group-title">${esc(title)}</div>` : ''}
      ${cardsHtml}
    </div>`;
  }
  // Your plan for the first 30 days: the three biggest things to fix,
  // picked from the actual card results — heaviest-weighted gaps first
  // (ties broken by the weakest score), not a generic scripted plan.
  // Which channels feed the actual funnel bottleneck computeRecommendation
  // already identified (rec.mode) — fixing the real constraint compounds
  // through the rest of the funnel, so those channels get first claim on
  // the plan's 3 slots regardless of their raw section weight.
  const IMPACT_SECTIONS_BY_MODE = {
    measure: ['measure'],
    book: ['capture', 'speed'],
    show: ['followup', 'show'],
    close: ['sales'],
    growth: ['content'],
  };
  function topThirtyDayActions(scores, rec) {
    const order = ['content', 'paidads', 'outreach', 'referrals', 'reviews', 'website', 'directories', 'capture', 'speed', 'followup', 'show', 'sales'];
    const boosted = new Set(IMPACT_SECTIONS_BY_MODE[rec?.mode] || []);
    const gaps = order.map(key => {
      const sec = SECTIONS.find(x => x.key === key); const s = scores.sections[key];
      // Points actually recoverable by fixing this channel — a low-weight
      // channel that's completely missing can matter more than a
      // high-weight one that's only slightly behind. Unmeasured/too-early
      // counts as full severity: it's unproven, not given the benefit of
      // the doubt.
      const severity = s.pct == null ? 1 : (100 - s.pct) / 100;
      const impact = sec.weight * severity;
      return { key, label: sec.label, weight: sec.weight, chip: s.chip, pct: s.pct, impact, bottleneck: boosted.has(key) };
    }).filter(c => c.chip !== 'strong');
    gaps.sort((x, y) => (y.bottleneck - x.bottleneck) || (y.impact - x.impact) || (y.weight - x.weight));
    return gaps.slice(0, 3);
  }
  function showReport() {
    const a = cur; const scores = computeScores(a); const rec = computeRecommendation(a, scores);
    const { ltv, gltv } = ltvMath(a);
    const group = CONFIG_GROUPS[rec.group];
    const targetClients = Number(a.answers.targetNewClients) || 4;
    const leadsNeeded = targetClients * 10;
    const serviceCardName = { Setup: 'Software Setup', Content: 'Content', 'Brand OS': 'Brand OS', 'Ads Management': 'Ads Management' }[rec.service] || rec.service;
    const rc = name => serviceCardName === name ? 'price-card recommended' : 'price-card';
    const recTag = name => serviceCardName === name ? '<span class="rec-tag">Recommended for you</span><br>' : '';
    const funnel = rec.funnel;
    const funnelRow = (label, val, floor, healthy) => {
      if (val == null) return `<tr><td>${label}</td><td colspan="2" class="muted">No data yet</td></tr>`;
      const cls = val < floor ? 'low' : 'ok';
      return `<tr><td>${label}</td><td class="${cls}">${Math.round(val)}%</td><td class="muted">floor ${floor}%${healthy ? `, healthy ${healthy}%+` : ''}</td></tr>`;
    };

    const sections = [];

    // Cover
    sections.push(`<div class="doc-cover">
      <h1 class="slide-title">Your Marketing Strategy</h1>
      <div class="slide-sub">A clear plan to get found, win more clients, and grow.</div>
      <div class="doc-cover-meta">
        <div>
          <div style="font-size:14px;">Prepared for ${esc(a.businessName || '[ practice name ]')}</div>
          <div style="font-size:12px; color:var(--dg-dust); margin-top:4px;">${esc(niceDate(todayStr()))} &middot; Gathr Grow</div>
        </div>
        <div class="doc-score-badge">
          <div class="num">${scores.headline}<small style="font-size:16px; color:#7d766e;"> / 100</small></div>
          <div class="lbl">Overall score</div>
        </div>
      </div>
    </div>`);

    // Where you stand today — headline score, job bars, funnel vs benchmark.
    // Shown right up top, before The Basics, so the client sees where they
    // stand before reading the framework.
    sections.push(`<div class="doc-section" style="margin-top:28px;">
      <div class="eyebrow-sm">YOUR SCORECARD</div>
      <h2 class="doc-h2">Where ${esc(a.businessName || 'you')} stand${a.businessName ? 's' : ''} today</h2>
      <div class="job-bars">${Object.entries(JOBS).map(([key, job]) => {
        const s = scores.jobs[key]; const pct = s.max ? s.score / s.max * 100 : 0;
        const cls = pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad';
        return `<div class="job-bar"><div class="jb-track"><div class="jb-fill ${cls}" style="height:${Math.max(3, pct)}%"></div></div><div class="jb-val">${s.score}/${s.max}</div><div class="jb-label">${esc(job.label)}</div></div>`;
      }).join('')}</div>
      <h2 class="doc-h2" style="margin-top:36px;">Your funnel today</h2>
      <table class="funnel-table" style="margin-top:10px;">
        <thead><tr><th>Stage</th><th>Your rate</th><th>Benchmark</th></tr></thead>
        <tbody>
          <tr><td>Leads (last month)</td><td colspan="2">${funnel.leads || '—'}</td></tr>
          ${funnelRow('Booked', funnel.bookPct, 60)}
          ${funnelRow('Showed', funnel.showPct, 60, 70)}
          ${funnelRow('Closed', funnel.closePct, 30, 35)}
        </tbody>
      </table>
    </div>`);

    // The Basics
    sections.push(`<div class="doc-section">
      <div class="eyebrow-sm">THE BASICS</div>
      <h2 class="doc-h2">The three jobs every business has to do</h2>
      <div class="card-grid-3">
        <div class="num-card"><div class="num">1</div><h4>Get found</h4><p>People need to know you exist.</p></div>
        <div class="num-card"><div class="num">2</div><h4>Capture interest</h4><p>Turn a stranger into a lead: someone who has shown interest and you can contact.</p></div>
        <div class="num-card"><div class="num">3</div><h4>Sell</h4><p>Turn that lead into a paying client.</p></div>
      </div>
      <div class="slide-italic">If one job is weak, growth slows. This plan checks all three.</div>

      <h2 class="doc-h2" style="margin-top:40px;">Measure the same four steps every month</h2>
      <div class="funnel-steps">
        <div class="fstep"><h4>Leads</h4><p>show interest</p></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep"><h4>Booked</h4><p>book a call</p></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep"><h4>Showed</h4><p>turn up</p></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep highlight"><h4>Closed</h4><p>become clients</p></div>
      </div>
      <p style="margin-top:24px; font-size:15px;">Track these four every month. Also ask every new person: "How did you hear about us?"</p>
      <div class="slide-italic">You cannot fix what you do not measure. Most practices track nothing. Start here.</div>

      <h2 class="doc-h2" style="margin-top:40px;">The numbers to aim for</h2>
      <div class="card-grid-3">
        <div class="num-card" style="text-align:center;"><div class="num">60%</div><h4>Book rate</h4><p>6 in 10 leads book</p></div>
        <div class="num-card" style="text-align:center;"><div class="num">60%</div><h4>Show rate</h4><p>6 in 10 who book turn up</p></div>
        <div class="num-card" style="text-align:center;"><div class="num">30%</div><h4>Close rate</h4><p>3 in 10 who show buy</p></div>
      </div>
      <div class="callout-box">At those rates, about 10 leads gets you 1 new client.</div>
      <div class="slide-italic" style="text-align:center;">Want ${targetClients} new client${targetClients === 1 ? '' : 's'} a month? You need about ${leadsNeeded} leads a month.</div>
    </div>`);

    // Job 1 — Get found (Job 2, Capture Interest, folds straight in below —
    // colour coding tells them apart, no separate divider needed for it)
    sections.push(docBanner('JOB 1', 'Get found', null, true));
    sections.push(`<div class="doc-section" style="margin-top:0;">
      <div class="eyebrow-sm">JOB 1 &middot; GET FOUND</div>
      <h2 class="doc-h2">Two ways to get found. You need both.</h2>
      <p style="font-size:14.5px; color:#57524c; max-width:640px;">Active: you put in time or money, and more people find you. Passive: you set it up once, and it works in the background. You need both.</p>
      ${docGroup('active', 'Active', [
        channelCard('Creating content', 'content', CHANNEL_BULLETS.content, scores),
        channelCard('Paid ads', 'paidads', CHANNEL_BULLETS.paidads, scores),
        channelCard('Outreach', 'outreach', CHANNEL_BULLETS.outreach, scores),
        channelCard('Events and workshops', null, [
          'Give a real experience, not a sales pitch.', 'Promote by email first, then social.',
          'Let people bring a friend.', 'Use one booking link so you can track it.', 'Follow up with everyone who comes.',
        ], scores),
      ].join(''))}
      ${docGroup('passive', 'Passive', [
        channelCard('Referrals', 'referrals', CHANNEL_BULLETS.referrals, scores),
        channelCard('Reviews and Google', 'reviews', CHANNEL_BULLETS.reviews, scores),
        channelCard('Your website (search and AI)', 'website', CHANNEL_BULLETS.website, scores),
        channelCard('Directory listings', 'directories', CHANNEL_BULLETS.directories, scores, group?.directories),
        channelCard('Word of mouth', null, [
          'The best marketing is a great experience.', 'Give people a simple story to pass on.',
          'Make it easy to share you.', 'You cannot force it, but you can earn it.',
        ], scores),
      ].join(''))}
      <div class="eyebrow-sm" style="margin-top:36px;">JOB 2 &middot; CAPTURE INTEREST</div>
      ${docGroup('capture', null, channelCard('Turning interest into leads', 'capture', CHANNEL_BULLETS.capture, scores))}
    </div>`);

    // Job 3 — Sell
    sections.push(docBanner('JOB 3', 'Sell', null, true));
    sections.push(`<div class="doc-section" style="margin-top:0;">
      ${docGroup('sell', null, [
        channelCard('Speed to reply', 'speed', CHANNEL_BULLETS.speed, scores),
        channelCard('Follow-up', 'followup', CHANNEL_BULLETS.followup, scores),
        channelCard('Show rate', 'show', CHANNEL_BULLETS.show, scores),
        channelCard('The sales call', 'sales', CHANNEL_BULLETS.sales, scores),
      ].join(''))}
    </div>`);

    // Putting it together
    sections.push(`<div class="doc-section">
      <div class="eyebrow-sm">PUTTING IT TOGETHER</div>
      <h2 class="doc-h2">How the jobs make your numbers</h2>
      <div class="funnel-steps">
        <div class="fstep"><h4>Leads</h4></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep"><h4>Booked</h4></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep"><h4>Showed</h4></div><div class="funnel-arrow">&gt;</div>
        <div class="fstep"><h4>Closed</h4></div>
      </div>
      <div style="display:flex; gap:12px; margin-top:8px;">
        <div style="flex:1; border-top:3px solid var(--dg-orange); padding-top:8px; font-size:13px; color:var(--dg-orange);">Jobs 1 and 2: get found and capture</div>
        <div style="width:20px;"></div>
        <div style="flex:2.6; border-top:3px solid var(--dg-good); padding-top:8px; font-size:13px; color:var(--dg-good); text-align:center;">Job 3: the sell</div>
      </div>
      <p style="margin-top:26px; font-size:15px;">More leads come from doing Jobs 1 and 2 better. Better book, show and close come from Job 3.</p>
    </div>`);

    // Your plan for the first 30 days — the biggest three things to fix,
    // weighted by actual business impact: whichever funnel stage is the
    // real bottleneck (computeRecommendation's mode) claims priority,
    // since fixing the true constraint compounds through the rest of the
    // funnel; remaining slots go to whichever channels have the most
    // points genuinely recoverable (weight x how far below good they
    // are), not just the highest-weight section. Directory listings uses
    // the practitioner-specific list instead of the generic quick win,
    // same as the channel card above.
    const quickWinFor = key => (key === 'directories' && group?.directories) || CHANNEL_META[key].quickWin;
    const top3 = topThirtyDayActions(scores, rec);
    sections.push(`<div class="doc-section">
      <div class="eyebrow-sm">YOUR PLAN</div>
      <h2 class="doc-h2">Your plan for the first 30 days</h2>
      ${top3.length ? `
      <p style="font-size:14.5px; color:#57524c;">${esc(rec.priorityBlurb || 'Based on where you stand today, here are the three biggest things to fix first.')}</p>
      <ul class="plan-checklist">
        ${top3.map(c => `<li><span class="chk"></span><span style="color:var(--dg-orange);">${esc(c.label)}:</span> ${esc(quickWinFor(c.key))}</li>`).join('')}
      </ul>` : `
      <p style="font-size:14.5px; color:#57524c;">You're already doing the fundamentals well across every channel — nothing urgent to fix this month. Keep it up.</p>`}
    </div>`);

    // Special notes — the practitioner-type compliance note (always
    // relevant, e.g. what a chiro can and can't say in marketing), the
    // client's own answer on their biggest gap, plus whatever the team
    // jotted down at the bottom of each part while running the session
    // live. Only shows parts that actually have something written.
    const notesLabels = { context: 'Context', wig: 'WIG', measure: 'Measurement', getfound: 'Get Found', capture: 'Capture Interest', sell: 'Sell' };
    const partNoteItems = Object.entries(a.answers.partNotes || {}).filter(([, v]) => (v || '').trim());
    const complianceNote = rec.compliance || group?.compliance;
    if (complianceNote || a.answers.biggestGap?.trim() || partNoteItems.length) {
      sections.push(`<div class="doc-section">
        <div class="eyebrow-sm">SPECIAL NOTES</div>
        <h2 class="doc-h2">Notes &amp; recommendations</h2>
        ${complianceNote ? `<div class="note-item"><h4>A note on compliance</h4><p>${esc(complianceNote)}</p></div>` : ''}
        ${a.answers.biggestGap?.trim() ? `<div class="note-item"><h4>Biggest gap, in their own words</h4><p>${esc(a.answers.biggestGap)}</p></div>` : ''}
        ${partNoteItems.map(([key, v]) => `<div class="note-item"><h4>${esc(notesLabels[key] || key)}</h4><p>${esc(v)}</p></div>`).join('')}
      </div>`);
    }

    // Ways to work with us
    sections.push(`<div class="doc-section">
      <div class="eyebrow-sm">HOW WE CAN HELP</div>
      <h2 class="doc-h2">Ways to work with us</h2>
      <p style="font-size:14.5px; color:#57524c; max-width:640px;">None of this is complicated, but it takes time, and time on marketing is time away from your clients. You can do all of it yourself — or, if you'd rather stay with your clients, this is exactly what we do.</p>
      <div class="price-grid">
        <div class="${rc('Brand OS')}">${recTag('Brand OS')}<h4>Brand OS - $4500</h4><p>We set up your whole foundation. Your first 120 days, done for you.</p></div>
        <div class="${rc('Ads Management')}">${recTag('Ads Management')}<h4>Ads Management</h4><p>We run your ads and fill your funnel. The next 120 days.</p></div>
      </div>
      <div class="price-subhead">Just want part of it?</div>
      <div class="price-grid">
        <div class="${rc('Software Setup')}">${recTag('Software Setup')}<h4>Software Setup - $1500</h4><p>We set up your systems, then hand you the keys.</p></div>
        <div class="${rc('Content')}">${recTag('Content')}<h4>Content - $1000/$1500</h4><p>We create your content, so you show up without the effort.</p></div>
      </div>
    </div>`);

    // Closing
    sections.push(docBanner(null, 'Either way, you now have the plan.', 'Let us help you decide where to start.'));

    sections.push(`<div class="doc-footer">Gathr Grow</div>`);

    $('reportInner').innerHTML = `<div class="doc-wrap">${sections.join('')}</div>`;
    $('formView').classList.add('hidden'); $('reportSection').classList.remove('hidden');
    // Every fresh render starts read-only — editing is opt-in per view, so
    // re-generating the report never silently leaves stale edits editable.
    const editBtn = $('editToggle'); if (editBtn) editBtn.textContent = 'Edit details';
    const editHint = $('editHint'); if (editHint) editHint.classList.add('hidden');
    document.getElementById('tab-diagnostic')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  function backToForm() { $('reportSection').classList.add('hidden'); $('formView').classList.remove('hidden'); }
  // Let the team fix wording or fill in a missing detail directly in the
  // rendered report before printing/saving as PDF — window.print() prints
  // the live DOM, so anything typed here is what ends up in the PDF.
  function toggleReportEdit() {
    const wrap = document.querySelector('#dg-reportInner .doc-wrap');
    if (!wrap) return;
    const turningOn = wrap.getAttribute('contenteditable') !== 'true';
    wrap.setAttribute('contenteditable', turningOn ? 'true' : 'false');
    wrap.classList.toggle('editing', turningOn);
    const btn = $('editToggle'); if (btn) btn.textContent = turningOn ? 'Done editing' : 'Edit details';
    const hint = $('editHint'); if (hint) hint.classList.toggle('hidden', !turningOn);
  }

  window.Diagnostic = {
    onOpen, showDash, newAssessment, openAssessment, deleteAssessment, showReport, backToForm, toggleReportEdit,
  };
})();
