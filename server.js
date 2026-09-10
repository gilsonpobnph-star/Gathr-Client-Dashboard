require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pass, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pass, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  return crypto.pbkdf2Sync(pass, salt, 100000, 64, 'sha512').toString('hex') === hash;
}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'gathr-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 },
}));

const PASS         = process.env.DASHBOARD_PASSWORD || 'GathrGrowAdmin';
const TEAM_MEMBERS = (process.env.TEAM_MEMBERS || 'Gil,Glaiza').split(',').map(s => s.trim());

// ── Local store ───────────────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, 'data', 'store.json');

const DEFAULT_PROGRAMS = {
  'Brand Basics': {
    id: 'Brand Basics', name: 'Brand Basics', duration: 4, price: '$1,500', color: '#3B6B9A',
    weeks: {
      1: { title: 'Week 1 — Onboarding & Setup', phase: 'Onboarding', items: [
        {id:'ICC',label:'Intake Call Completed'},{id:'BAR',label:'Brand Assets Received'},
        {id:'SLR',label:'Social Links Received'},{id:'DAR',label:'Domain Access Received'},
        {id:'CQR',label:'Content Questionnaire Received'},
      ]},
      2: { title: 'Week 2 — Funnel & Tech Build', phase: 'Build', items: [
        {id:'FB',label:'Funnel Built'},{id:'FA',label:'Funnel Approved'},
        {id:'DC',label:'Domain Connected'},{id:'BNP',label:'Business Number Purchased'},
        {id:'SDC',label:'Sending Domain Connected'},{id:'CC',label:'Calendar Connected'},
        {id:'PC',label:'Pipelines Created'},{id:'AC',label:'Automations Created'},
        {id:'ETL',label:'Email Templates Loaded'},{id:'BCC',label:'Booking Calendar Created'},
        {id:'ICN',label:'Integrations Connected'},
      ]},
      3: { title: 'Week 3 — Content & Optimisation', phase: 'Content', items: [
        {id:'BO',label:'Bio Optimized'},{id:'CTAF',label:'CTA Finalized'},
        {id:'PPP',label:'Pinned Posts Planned'},{id:'CSC',label:'Content Strategy Completed'},
        {id:'FSS',label:'Filming Session Scheduled'},{id:'FCBD',label:'First Content Batch Delivered'},
        {id:'RCC',label:'Revision Call Completed'},
      ]},
      4: { title: 'Week 4 — Launch', phase: 'Launch', items: [
        {id:'CTC',label:'Client Training Completed'},{id:'PS',label:'Playbook Sent'},
        {id:'WTCA',label:'Weekly Tech Call Assigned'},{id:'CASG',label:'Client Added To Support Group'},
        {id:'IQAC',label:'Internal QA Completed'},{id:'RFL',label:'Ready For Launch'},
        {id:'LC',label:'Launch Completed'},
      ]},
    },
  },
  'Personal Brand Foundation': {
    id: 'Personal Brand Foundation', name: 'Personal Brand Foundation', duration: 12, price: '$4,500', color: '#7A52A0',
    weeks: {
      1:{title:'Week 1 — Intake & Filming',phase:'Phase 1 · System Build',items:[
        {id:'IF',label:'Intake form submitted'},{id:'BDC',label:'Branding direction call done'},
        {id:'CFS',label:'Content filming session completed'},{id:'WIGM',label:'WIG meeting attended'},
        {id:'BPCL',label:'Bio/profile content launched'},
      ]},
      2:{title:'Week 2 — Software Build',phase:'Phase 1 · System Build',items:[
        {id:'CRMf',label:'CRM & funnel built'},{id:'Auto',label:'Automations set up'},
        {id:'Cal',label:'Booking calendar live'},{id:'Dom',label:'Domain connected'},
        {id:'BPN',label:'Business phone number set up'},{id:'Offer',label:'Offer configured'},
        {id:'FOS',label:'Funnel / offer setup complete'},
      ]},
      3:{title:'Week 3 — Review & Revisions',phase:'Phase 1 · System Build',items:[
        {id:'RSB',label:'Review & sign-off on build'},{id:'ACF',label:'Attended revision call, gave feedback'},
        {id:'FCL',label:'Final confirmation & launch approved'},
      ]},
      4:{title:'Week 4 — Onboarding & Launch',phase:'Phase 1 · System Build',items:[
        {id:'CRMT',label:'1:1 CRM training delivered'},{id:'SOPP',label:'SOPs & playbook sent'},
        {id:'SMM',label:'Social media management started'},{id:'Launch',label:'System fully launched'},
      ]},
      5:{title:'Week 5',phase:'Phase 2 · Lead-Gen Activation',items:[]},
      6:{title:'Week 6',phase:'Phase 2 · Lead-Gen Activation',items:[]},
      7:{title:'Week 7',phase:'Phase 2 · Lead-Gen Activation',items:[]},
      8:{title:'Week 8',phase:'Phase 2 · Lead-Gen Activation',items:[]},
      9:{title:'Week 9',phase:'Phase 3 · Independence + Paid Ads',items:[]},
      10:{title:'Week 10',phase:'Phase 3 · Independence + Paid Ads',items:[]},
      11:{title:'Week 11',phase:'Phase 3 · Independence + Paid Ads',items:[]},
      12:{title:'Week 12',phase:'Phase 3 · Independence + Paid Ads',items:[]},
    },
  },
  'Personal Brand Full': {
    id: 'Personal Brand Full', name: 'Personal Brand Full', duration: 16, price: 'Custom', color: '#C4522A',
    weeks: {
      1:{title:'Week 1 — Intake & Setup',phase:'Phase 1 · System Build',items:[
        {id:'IFC',label:'Intake call / form completed'},
        {id:'BDC',label:'Branding direction call done'},
        {id:'BAR',label:'Brand assets received'},
        {id:'SLR',label:'Social links received'},
        {id:'DAR',label:'Domain access received'},
        {id:'CQR',label:'Content questionnaire received'},
        {id:'BPCL',label:'Bio / profile content launched'},
        {id:'WIG1',label:'Weekly WIG meeting held'},
      ]},
      2:{title:'Week 2 — Software Build',phase:'Phase 1 · System Build',items:[
        {id:'CRMf',label:'CRM & funnel built'},
        {id:'FA',label:'Funnel approved by client'},
        {id:'Auto',label:'Automations set up'},
        {id:'Cal',label:'Booking calendar live'},
        {id:'Dom',label:'Domain connected'},
        {id:'SDC',label:'Sending domain connected'},
        {id:'BPN',label:'Business phone number set up'},
        {id:'PC',label:'Pipelines created (×2)'},
        {id:'ETL',label:'Email templates loaded'},
        {id:'Offer',label:'Offer configured'},
        {id:'ICN',label:'Integrations connected'},
        {id:'WIG2',label:'Weekly WIG meeting held'},
      ]},
      3:{title:'Week 3 — Review & Revisions',phase:'Phase 1 · System Build',items:[
        {id:'RSB',label:'Review & sign-off on build'},
        {id:'ACF',label:'Revision call — feedback given & applied'},
        {id:'FCL',label:'Final confirmation & launch approved'},
        {id:'OBR',label:'1:1 onboarding session recorded'},
        {id:'SOPP',label:'SOPs & playbook sent'},
        {id:'CASG',label:'Client added to support group'},
        {id:'WIG3',label:'Weekly WIG meeting held'},
      ]},
      4:{title:'Week 4 — Onboarding & Launch',phase:'Phase 1 · System Build',items:[
        {id:'CRMT',label:'1:1 CRM training delivered'},
        {id:'SMM',label:'Social media management started'},
        {id:'IQA',label:'Internal QA completed'},
        {id:'RFL',label:'Ready for launch confirmed'},
        {id:'Launch',label:'System fully launched'},
        {id:'WIG4',label:'Weekly WIG meeting held'},
      ]},
      5:{title:'Week 5 — Outreach Foundation',phase:'Phase 2 · Lead-Gen Activation',items:[
        {id:'OSS',label:'Outreach strategy session completed'},
        {id:'DMS',label:'DM / outreach scripts delivered'},
        {id:'SCF',label:'Sales call framework delivered'},
        {id:'WIG5',label:'Weekly WIG meeting held'},
      ]},
      6:{title:'Week 6 — Sales Coaching',phase:'Phase 2 · Lead-Gen Activation',items:[
        {id:'PLR',label:'Pipeline review completed'},
        {id:'CTS',label:'Conversion tracking set up'},
        {id:'BRB',label:'Booking rate baseline noted'},
        {id:'WIG6',label:'Weekly WIG meeting held'},
      ]},
      7:{title:'Week 7 — Outreach Execution',phase:'Phase 2 · Lead-Gen Activation',items:[
        {id:'OCA',label:'Outreach cadence confirmed live'},
        {id:'FSR',label:'Follow-up sequences reviewed'},
        {id:'ADJ',label:'Funnel / script adjustments made'},
        {id:'WIG7',label:'Weekly WIG meeting held'},
      ]},
      8:{title:'Week 8 — Lead-Gen Review',phase:'Phase 2 · Lead-Gen Activation',items:[
        {id:'BRR',label:'Booking rate reviewed vs baseline'},
        {id:'LFC',label:'Lead flow consistency confirmed'},
        {id:'P2D',label:'Phase 2 debrief completed'},
        {id:'WIG8',label:'Weekly WIG meeting held'},
      ]},
      9:{title:'Week 9 — Content Strategy',phase:'Phase 3 · Independence + Content',items:[
        {id:'CSC',label:'Content strategy session completed'},
        {id:'BO',label:'Bio optimized'},
        {id:'CTAF',label:'CTA finalized'},
        {id:'PPP',label:'Pinned posts planned'},
        {id:'CCR',label:'Content calendar created'},
        {id:'WIG9',label:'Weekly WIG meeting held'},
      ]},
      10:{title:'Week 10 — Content Production',phase:'Phase 3 · Independence + Content',items:[
        {id:'FSC',label:'Filming session scheduled & completed'},
        {id:'CES',label:'Content editing started'},
        {id:'WIG10',label:'Weekly WIG meeting held'},
      ]},
      11:{title:'Week 11 — Content Delivery',phase:'Phase 3 · Independence + Content',items:[
        {id:'FCBD',label:'First content batch delivered'},
        {id:'RCC',label:'Revision call completed'},
        {id:'CCH',label:'Content calendar handed over'},
        {id:'WIG11',label:'Weekly WIG meeting held'},
      ]},
      12:{title:'Week 12 — Content Coaching',phase:'Phase 3 · Independence + Content',items:[
        {id:'PCR',label:'Posting consistency reviewed'},
        {id:'ESD',label:'Engagement strategy discussed'},
        {id:'CPI',label:'Client posting independently confirmed'},
        {id:'P3D',label:'Phase 3 debrief completed'},
        {id:'WIG12',label:'Weekly WIG meeting held'},
      ]},
      13:{title:'Week 13 — Event Prep',phase:'Phase 4 · Live Event + Paid Ads',items:[
        {id:'EVC',label:'Live event / seminar date confirmed'},
        {id:'EVA',label:'Event topic & agenda finalized'},
        {id:'EVP',label:'Event promoted to audience'},
        {id:'WIG13',label:'Weekly WIG meeting held'},
      ]},
      14:{title:'Week 14 — Ads Build',phase:'Phase 4 · Live Event + Paid Ads',items:[
        {id:'EAC',label:'Engagement ad campaign built & live'},
        {id:'LAC',label:'Lead-gen ad campaign built & live'},
        {id:'WIG14',label:'Weekly WIG meeting held'},
      ]},
      15:{title:'Week 15 — Live Event',phase:'Phase 4 · Live Event + Paid Ads',items:[
        {id:'EVH',label:'Live event / seminar held'},
        {id:'PED',label:'Post-event debrief completed'},
        {id:'APR',label:'Ad performance report delivered'},
        {id:'WIG15',label:'Weekly WIG meeting held'},
      ]},
      16:{title:'Week 16 — Program Wrap-up',phase:'Phase 4 · Live Event + Paid Ads',items:[
        {id:'FPR',label:'Final performance review completed'},
        {id:'PRC',label:'Full program recap delivered'},
        {id:'SOC',label:'Client sign-off / completion call held'},
        {id:'RTR',label:'Referral / testimonial requested'},
        {id:'WIG16',label:'Weekly WIG meeting held'},
      ]},
    },
  },
  'Content': {
    id: 'Content', name: 'Content', duration: 4, price: '$1,000–$1,500/mo', color: '#B07A28',
    weeks: {
      1:{title:'Week 1 — Planning',phase:'Planning',items:[
        {id:'CSS',label:'Content strategy session completed'},
        {id:'MCP',label:'Monthly content plan created & approved'},
        {id:'SLB',label:'Shot list / content brief sent to client'},
        {id:'FSD',label:'Filming session date confirmed'},
      ]},
      2:{title:'Week 2 — Filming',phase:'Production',items:[
        {id:'FSC',label:'Filming session completed'},
        {id:'RFR',label:'Raw footage received & reviewed'},
        {id:'EBC',label:'Editing brief confirmed'},
      ]},
      3:{title:'Week 3 — Editing & Delivery',phase:'Delivery',items:[
        {id:'HR4',label:'Hero reels edited & delivered (×4)'},
        {id:'BR8',label:'Basic reels edited & delivered (×8)'},
        {id:'SR8',label:'Short branded reels edited & delivered (×8)'},
        {id:'PH5',label:'Photos edited & delivered (×5)'},
      ]},
      4:{title:'Week 4 — Review & Schedule',phase:'Wrap-up',items:[
        {id:'CRR',label:'Client revision requests received'},
        {id:'RVC',label:'Revisions completed'},
        {id:'CPC',label:'Content posting calendar delivered'},
        {id:'ACS',label:'All content scheduled / ready to post'},
        {id:'MRC',label:'Monthly review call completed'},
      ]},
    },
  },
  'Ads Management': {
    id: 'Ads Management', name: 'Ads Management', duration: 4, price: '$1,000–$1,500/mo', color: '#C4522A',
    weeks: {
      1:{title:'Week 1 — Setup & Launch',phase:'Setup',items:[
        {id:'AAG',label:'Ad account access granted'},
        {id:'AAA',label:'Ad account audited'},
        {id:'PTC',label:'Pixel / tracking confirmed'},
        {id:'SCS',label:'Campaign strategy session completed'},
        {id:'ACB',label:'Ad creatives received / briefed'},
        {id:'CAB',label:'Campaigns built'},
        {id:'CAL',label:'Campaigns live'},
      ]},
      2:{title:'Week 2 — WIG & Optimise',phase:'Management',items:[
        {id:'WIG2',label:'Weekly WIG meeting held'},
        {id:'PBN',label:'Campaign performance baseline noted'},
        {id:'IOM',label:'Initial optimisations made'},
        {id:'ABT',label:'A/B test variants set up'},
      ]},
      3:{title:'Week 3 — Review & Adjust',phase:'Management',items:[
        {id:'WIG3',label:'Weekly WIG meeting held'},
        {id:'PDR',label:'Performance data reviewed'},
        {id:'BPC',label:'Budget pacing checked'},
        {id:'ACA',label:'Audience / creative adjustments made'},
      ]},
      4:{title:'Week 4 — Report & Plan',phase:'Reporting',items:[
        {id:'WIG4',label:'Weekly WIG meeting held'},
        {id:'MPR',label:'Monthly performance report delivered'},
        {id:'CFO',label:'Campaign fully optimised'},
        {id:'BRM',label:'Budget & strategy review for next month'},
      ]},
    },
  },
  'Website': {
    id: 'Website', name: 'Website', duration: 5, price: '$3,500', color: '#4A7C5C',
    weeks: {
      1:{title:'Week 1 — Discovery',phase:'Discovery',items:[
        {id:'DCC',label:'Discovery call completed'},
        {id:'SCA',label:'Scope of work confirmed & approved'},
        {id:'BAR',label:'Brand assets received'},
        {id:'CPB',label:'Copy brief sent to client'},
      ]},
      2:{title:'Week 2 — Design',phase:'Design',items:[
        {id:'SPA',label:'Sitemap / page structure approved'},
        {id:'WMP',label:'Wireframes / mockups presented'},
        {id:'DAC',label:'Design approved by client'},
      ]},
      3:{title:'Week 3 — Build',phase:'Build',items:[
        {id:'WBL',label:'Website built'},
        {id:'MRC',label:'Mobile responsiveness confirmed'},
        {id:'BIC',label:'Booking / CRM integration connected'},
        {id:'DCL',label:'Domain connected & SSL live'},
      ]},
      4:{title:'Week 4 — Review',phase:'Review',items:[
        {id:'CRC',label:'Client review call completed'},
        {id:'RVA',label:'Revisions applied'},
        {id:'IQA',label:'Internal QA completed'},
      ]},
      5:{title:'Week 5 — Launch',phase:'Launch',items:[
        {id:'WSL',label:'Website launched'},
        {id:'CTH',label:'Client training / handover completed'},
        {id:'PLC',label:'Post-launch check completed (48 hrs)'},
        {id:'PSO',label:'Project signed off'},
      ]},
    },
  },
  'Old Program': {
    id: 'Old Program', name: 'Old Program', duration: 4, price: '—', color: '#8A7A6E',
    weeks: {
      1:{title:'Week 1 — Onboarding & Setup',phase:'Onboarding',items:[
        {id:'ICC',label:'Intake Call Completed'},{id:'BAR',label:'Brand Assets Received'},
        {id:'SLR',label:'Social Links Received'},{id:'DAR',label:'Domain Access Received'},
        {id:'CQR',label:'Content Questionnaire Received'},
      ]},
      2:{title:'Week 2 — Funnel & Tech Build',phase:'Build',items:[
        {id:'FB',label:'Funnel Built'},{id:'FA',label:'Funnel Approved'},
        {id:'DC',label:'Domain Connected'},{id:'BNP',label:'Business Number Purchased'},
        {id:'SDC',label:'Sending Domain Connected'},{id:'CC',label:'Calendar Connected'},
        {id:'PC',label:'Pipelines Created'},{id:'AC',label:'Automations Created'},
        {id:'ETL',label:'Email Templates Loaded'},{id:'BCC',label:'Booking Calendar Created'},
        {id:'ICN',label:'Integrations Connected'},
      ]},
      3:{title:'Week 3 — Content & Optimisation',phase:'Content',items:[
        {id:'BO',label:'Bio Optimized'},{id:'CTAF',label:'CTA Finalized'},
        {id:'PPP',label:'Pinned Posts Planned'},{id:'CSC',label:'Content Strategy Completed'},
        {id:'FSS',label:'Filming Session Scheduled'},{id:'FCBD',label:'First Content Batch Delivered'},
        {id:'RCC',label:'Revision Call Completed'},
      ]},
      4:{title:'Week 4 — Launch',phase:'Launch',items:[
        {id:'CTC',label:'Client Training Completed'},{id:'PS',label:'Playbook Sent'},
        {id:'WTCA',label:'Weekly Tech Call Assigned'},{id:'CASG',label:'Client Added To Support Group'},
        {id:'IQAC',label:'Internal QA Completed'},{id:'RFL',label:'Ready For Launch'},
        {id:'LC',label:'Launch Completed'},
      ]},
    },
  },
};

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { clients: {}, programs: {}, meta: { version: '2.0', createdAt: new Date().toISOString() } }; }
}

function ensurePrograms(store) {
  if (!store.programs || !Object.keys(store.programs).length) {
    store.programs = JSON.parse(JSON.stringify(DEFAULT_PROGRAMS));
    return;
  }
  // Add any new default programs that don't exist in the store yet
  for (const [key, def] of Object.entries(DEFAULT_PROGRAMS)) {
    if (!store.programs[key]) {
      store.programs[key] = JSON.parse(JSON.stringify(def));
    }
  }
  // Migrate: update Personal Brand Full if it still has old empty weeks 5-16
  const pbf = store.programs['Personal Brand Full'];
  if (pbf && (!pbf.weeks[5]?.items?.length && !pbf.weeks[16]?.items?.length)) {
    store.programs['Personal Brand Full'] = JSON.parse(JSON.stringify(DEFAULT_PROGRAMS['Personal Brand Full']));
  }
}

const DEFAULT_ADDONS = {
  'Content Management': {
    id: 'Content Management', name: 'Content Management', color: '#B07A28',
    deliverables: [
      {id:'cm_plan',label:'Monthly content plan created'},
      {id:'cm_film',label:'Filming session completed'},
      {id:'cm_edit',label:'Reels edited & delivered'},
      {id:'cm_post',label:'Content scheduled & posted'},
    ],
  },
  'Ads Management': {
    id: 'Ads Management', name: 'Ads Management', color: '#C4522A',
    deliverables: [
      {id:'ads_build',label:'Ad campaigns built'},
      {id:'ads_live', label:'Campaigns live'},
      {id:'ads_wig',  label:'Weekly WIG meeting held'},
      {id:'ads_report',label:'Performance report sent'},
      {id:'ads_optim',label:'Campaign optimised'},
    ],
  },
  'Website': {
    id: 'Website', name: 'Website', color: '#4A7C5C',
    deliverables: [
      {id:'web_brief', label:'Discovery call & brief completed'},
      {id:'web_design',label:'Design mockup approved'},
      {id:'web_build', label:'Website built'},
      {id:'web_review',label:'Client review & revisions done'},
      {id:'web_launch',label:'Website launched'},
    ],
  },
};

function ensureAddons(store) {
  if (!store.addons || !Object.keys(store.addons).length) {
    store.addons = JSON.parse(JSON.stringify(DEFAULT_ADDONS));
  }
}

function ensureAdminUser(store) {
  if (!store.users) store.users = {};
  const adminEmail = (process.env.ADMIN_EMAIL || 'gilson.po.bnph@gmail.com').toLowerCase();
  const exists = Object.values(store.users).some(u => u.email === adminEmail);
  if (!exists) {
    const id = 'u_admin_seed';
    const pass = process.env.DASHBOARD_PASSWORD || 'GathrGrowAdmin';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pass, salt, 100000, 64, 'sha512').toString('hex');
    store.users[id] = { id, name: 'Gilson', email: adminEmail, passwordHash: `${salt}:${hash}`, role: 'admin', createdAt: new Date().toISOString() };
    console.log(`[seed] Admin user created: ${adminEmail}`);
  }
}

function ensureTeam(store) {
  if (!store.team) {
    // Seed from env var on first boot so existing deployments keep their names
    const fromEnv = (process.env.TEAM_MEMBERS || 'Gil,Glaiza').split(',').map(s => s.trim()).filter(Boolean);
    store.team = fromEnv.map((name, i) => ({
      id: 'tm_' + (i + 1),
      name,
      email: '',
      role: 'lead', // 'admin' | 'lead' | 'tech'
      createdAt: new Date().toISOString(),
    }));
  }
}

function writeStore(data) {
  data.meta = data.meta || {};
  data.meta.lastModified = new Date().toISOString();
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function genId() {
  return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function shapeClient(c) {
  // ── Multi-program migration ──────────────────────────────────────────────
  const programs = Array.isArray(c.programs)
    ? [...new Set(c.programs.filter(Boolean))]
    : (c.program ? [c.program] : []);

  // Per-program week tracking
  let programWeeks = c.programWeeks ? { ...c.programWeeks } : {};
  if (programs[0] && !programWeeks[programs[0]] && c.currentWeek) {
    programWeeks[programs[0]] = parseInt(c.currentWeek) || 1;
  }
  programs.forEach(p => { if (!programWeeks[p]) programWeeks[p] = 1; });

  // Migrate checklists: flat { week: fields } → { programId: { week: fields } }
  let checklists = c.checklists ? JSON.parse(JSON.stringify(c.checklists)) : {};
  if (programs[0] && Object.keys(checklists).length > 0) {
    const firstKey = Object.keys(checklists)[0];
    if (!isNaN(firstKey)) checklists = { [programs[0]]: checklists };
  }

  // Migrate checklistNotes: flat { week: notes } → { programId: { week: notes } }
  let checklistNotes = c.checklistNotes ? JSON.parse(JSON.stringify(c.checklistNotes)) : {};
  if (programs[0] && Object.keys(checklistNotes).length > 0) {
    const firstKey = Object.keys(checklistNotes)[0];
    if (!isNaN(firstKey)) checklistNotes = { [programs[0]]: checklistNotes };
  }

  return {
    id:                 c.id                 || genId(),
    name:               c.name               || '',
    businessName:       c.businessName       || '',
    email:              c.email              || '',
    phone:              c.phone              || '',
    instagram:          c.instagram          || '',
    otherSocials:       c.otherSocials       || '',
    website:            c.website            || '',
    business:           c.business           || '',
    program:            programs[0]          || '',   // primary (backward compat)
    programs,                                         // all programs (new)
    programStatuses:    c.programStatuses    || {},   // per-program status (new)
    programStartDates:    c.programStartDates    || {},   // per-program start date
    status:             c.status             || '',
    currentWeek:        programWeeks[programs[0]] || parseInt(c.currentWeek) || 1,
    programWeeks,                                     // per-program weeks (new)
    startDate:          c.startDate          || '',
    leadAssignee:       c.leadAssignee       || '',
    techAssignee:       c.techAssignee       || '',
    brandDirection:     c.brandDirection     || '',
    servicesAndPricing: c.servicesAndPricing || '',
    targetAudience:     c.targetAudience     || '',
    goals:              c.goals              || '',
    logoUrl:            c.logoUrl            || '',
    currentFollowers:   c.currentFollowers   || '',
    filmingAvailability:c.filmingAvailability|| '',
    existingContent:    c.existingContent    || '',
    heardAboutUs:       c.heardAboutUs       || '',
    anythingElse:       c.anythingElse       || '',
    notes:              c.notes              || '',
    notesLog:           c.notesLog           || [],
    addOns:             c.addOns             || '',
    intakeSubmitted:    c.intakeSubmitted     || '',
    activityLog:        c.activityLog        || [],
    lastActivityAt:     (c.activityLog || [])[0]?.ts || null,
    oldProgramChecklist:c.oldProgramChecklist|| {},
    programLeads:       c.programLeads       || {},   // per-program lead assignee
    checklists,                                       // now namespaced by programId
    checklistAssignees: c.checklistAssignees || {},   // per-program/week/item assignee
    addonChecklists:    c.addonChecklists    || {},
    checklistNotes,                                   // now namespaced by programId
    addonChecklistNotes: c.addonChecklistNotes || {},
    createdAt:          c.createdAt          || new Date().toISOString(),
  };
}

function parseNotesLog(val) {
  if (!val) return [];
  try {
    const p = JSON.parse(val);
    if (Array.isArray(p)) return p;
    return [{ author: 'System', text: String(val), ts: new Date(0).toISOString() }];
  } catch {
    return [{ author: 'System', text: String(val), ts: new Date(0).toISOString() }];
  }
}

// ── Activity Logging ──────────────────────────────────────────────────────────
function logActivity(store, req, action, { clientId, clientName, details } = {}) {
  store.activityLog = store.activityLog || [];
  const entry = {
    id:         'al_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    ts:         new Date().toISOString(),
    userId:     req.session.userId || 'admin',
    userName:   req.session.name   || 'Admin',
    action,
    clientId:   clientId   || null,
    clientName: clientName || null,
    details:    details    || null,
  };
  store.activityLog.unshift(entry);
  if (store.activityLog.length > 3000) store.activityLog = store.activityLog.slice(0, 3000);
  // Also push to per-client log
  if (clientId && store.clients?.[clientId]) {
    const c = store.clients[clientId];
    c.activityLog = c.activityLog || [];
    c.activityLog.unshift(entry);
    if (c.activityLog.length > 500) c.activityLog = c.activityLog.slice(0, 500);
  }
  return entry;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function requireAdmin(req, res, next) {
  if (req.session.authenticated && req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}

// Admin login (password only) OR team member login (email + password)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email && email.trim()) {
    // Team member login
    const store = readStore();
    const users = store.users || {};
    const user  = Object.values(users).find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.role   = user.role || 'member';
    req.session.name   = user.name;
    return res.json({ ok: true, role: user.role || 'member', name: user.name });
  }
  // Admin fallback — password only
  if (password === PASS) {
    req.session.authenticated = true;
    req.session.userId = 'admin';
    req.session.role   = 'admin';
    req.session.name   = 'Admin';
    return res.json({ ok: true, role: 'admin', name: 'Admin' });
  }
  res.status(401).json({ error: 'Invalid password' });
});

// Team member self-registration
app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  const store = readStore();
  if (!store.users) store.users = {};
  const existing = Object.values(store.users).find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id   = 'u_' + Date.now();
  const user = { id, name: name.trim(), email: email.trim().toLowerCase(), passwordHash: hashPassword(password), role: 'member', createdAt: new Date().toISOString() };
  store.users[id] = user;
  writeStore(store);
  res.json({ ok: true, id, name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.authenticated) return res.json({ authenticated: false });
  res.json({ authenticated: true, userId: req.session.userId, role: req.session.role || 'admin', name: req.session.name || 'Admin' });
});

// ── Users (registered team members) — admin only ─────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const store = readStore();
  const users = Object.values(store.users || {}).map(({ passwordHash, ...u }) => u);
  res.json(users);
});

app.put('/api/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const store = readStore();
  if (!store.users?.[req.params.id]) return res.status(404).json({ error: 'User not found' });
  store.users[req.params.id].role = role;
  writeStore(store);
  res.json({ ok: true });
});

app.put('/api/users/:id/teamrole', requireAdmin, (req, res) => {
  const { teamRole } = req.body;
  if (!['lead', 'tech', 'admin'].includes(teamRole)) return res.status(400).json({ error: 'Invalid role' });
  const store = readStore();
  if (!store.users?.[req.params.id]) return res.status(404).json({ error: 'User not found' });
  const u = store.users[req.params.id];
  logActivity(store, req, 'Team role changed', { details: `${u.name}: ${u.teamRole || 'lead'} → ${teamRole}` });
  u.teamRole = teamRole;
  writeStore(store);
  res.json({ ok: true });
});

app.put('/api/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password?.trim()) return res.status(400).json({ error: 'Password required' });
  const store = readStore();
  if (!store.users?.[req.params.id]) return res.status(404).json({ error: 'User not found' });
  store.users[req.params.id].passwordHash = hashPassword(password.trim());
  writeStore(store);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const store = readStore();
  if (!store.users?.[req.params.id]) return res.status(404).json({ error: 'User not found' });
  delete store.users[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});

// Team CRUD — names only for dropdowns
app.get('/api/team', requireAuth, (req, res) => {
  const store = readStore();
  ensureTeam(store);

  // Remove any previously auto-synced duplicates (tm_u_ entries)
  const userEmails = new Set(Object.values(store.users || {}).map(u => u.email.toLowerCase()));
  const before = store.team.length;
  store.team = store.team.filter(m => !m.id.startsWith('tm_u_'));
  if (store.team.length !== before) writeStore(store); // save cleanup once

  // Registered users appear in dropdowns via their teamRole field
  const registeredTeam = Object.values(store.users || {}).map(u => ({
    id: u.id, name: u.name, email: u.email,
    role: u.teamRole || 'lead',
    createdAt: u.createdAt, isRegistered: true,
  }));
  // Manual roster only — exclude any manually added entries that duplicate a registered email
  const manualOnly = store.team.filter(m => !m.email || !userEmails.has(m.email.toLowerCase()));
  res.json([...registeredTeam, ...manualOnly]);
});

app.post('/api/team', requireAuth, (req, res) => {
  const { name, email, role } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const store = readStore();
  ensureTeam(store);
  if (store.team.some(m => m.name.toLowerCase() === name.trim().toLowerCase()))
    return res.status(409).json({ error: 'Team member already exists' });
  const member = { id: 'tm_' + Date.now(), name: name.trim(), email: email?.trim() || '', role: role || 'lead', createdAt: new Date().toISOString() };
  store.team.push(member);
  logActivity(store, req, 'Team member added', { details: `${member.name} as ${member.role}` });
  writeStore(store);
  res.json(member);
});

app.put('/api/team/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureTeam(store);
  const idx = store.team.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  store.team[idx] = { ...store.team[idx], ...req.body, id: req.params.id };
  writeStore(store);
  res.json(store.team[idx]);
});

app.delete('/api/team/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureTeam(store);
  const member = store.team.find(m => m.id === req.params.id);
  store.team = store.team.filter(m => m.id !== req.params.id);
  if (member) logActivity(store, req, 'Team member removed', { details: member.name });
  writeStore(store);
  res.json({ ok: true });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
function ensureChat(store) {
  if (!store.chat) store.chat = { rooms: {} };
  if (!store.chat.rooms['general']) store.chat.rooms['general'] = { messages: [] };
}

function dmRoomId(a, b) { return 'dm__' + [a, b].sort().join('__'); }

function canAccessRoom(roomId, session) {
  if (!roomId.startsWith('dm__')) return true;
  const parts = roomId.split('__').slice(1);
  return session.role === 'admin' || parts.includes(session.name || '');
}

// List rooms visible to current user (sidebar data)
app.get('/api/chat', requireAuth, (req, res) => {
  const store = readStore();
  ensureChat(store);
  const userName = req.session.name || '';
  const rooms = [];

  // General always first
  const genMsgs = store.chat.rooms['general'].messages || [];
  rooms.push({ id: 'general', name: 'General', type: 'channel',
    messageCount: genMsgs.length,
    lastMessage: genMsgs[genMsgs.length - 1] || null });

  // DMs this user is part of (skip self-DMs, deduplicate by other user)
  const seenDmPartners = new Set();
  Object.entries(store.chat.rooms).forEach(([id, room]) => {
    if (!id.startsWith('dm__')) return;
    if (!canAccessRoom(id, req.session)) return;
    const parts = id.split('__').slice(1);
    const other = parts.find(p => p !== userName) || null;
    if (!other || seenDmPartners.has(other)) return; // skip self-DMs and dupes
    seenDmPartners.add(other);
    const msgs  = room.messages || [];
    rooms.push({ id, name: other, type: 'dm',
      messageCount: msgs.length,
      lastMessage: msgs[msgs.length - 1] || null });
  });

  res.json(rooms);
});

// Get messages for a room (supports ?since= for polling)
app.get('/api/chat/:roomId', requireAuth, (req, res) => {
  const store = readStore();
  ensureChat(store);
  if (!canAccessRoom(req.params.roomId, req.session)) return res.status(403).json({ error: 'Forbidden' });
  const room = store.chat.rooms[req.params.roomId];
  if (!room) return res.json({ messages: [] });
  let msgs = room.messages || [];
  if (req.query.since) msgs = msgs.filter(m => m.ts > req.query.since);
  res.json({ messages: msgs.slice(-200) });
});

// Post message to a room
app.post('/api/chat/:roomId', requireAuth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  // Strip any HTML to prevent XSS
  const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const store = readStore();
  ensureChat(store);
  const roomId = req.params.roomId;
  if (!canAccessRoom(roomId, req.session)) return res.status(403).json({ error: 'Forbidden' });
  if (!store.chat.rooms[roomId]) store.chat.rooms[roomId] = { messages: [] };
  const msg = {
    id:  'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    text: safe,
    author:   req.session.name   || 'Team',
    authorId: req.session.userId || 'admin',
    ts: new Date().toISOString(),
  };
  store.chat.rooms[roomId].messages.push(msg);
  // Cap at 500 messages per room
  if (store.chat.rooms[roomId].messages.length > 500) {
    store.chat.rooms[roomId].messages = store.chat.rooms[roomId].messages.slice(-500);
  }
  writeStore(store);
  res.json(msg);
});

// Start a DM (creates the room so it shows in sidebar before first message)
app.post('/api/chat/dm/start', requireAuth, (req, res) => {
  const { withUser } = req.body;
  if (!withUser) return res.status(400).json({ error: 'withUser required' });
  const store  = readStore();
  ensureChat(store);
  const roomId = dmRoomId(req.session.name || '', withUser);
  if (!store.chat.rooms[roomId]) { store.chat.rooms[roomId] = { messages: [] }; writeStore(store); }
  res.json({ roomId });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
function ensureTasks(store) { if (!store.tasks) store.tasks = {}; }

function canSeeTask(task, session) {
  const name = session.name || '';
  // Backward compat: tasks created via the legacy admin login have createdBy:'Admin'
  // — keep these visible to any admin-role user
  if (session.role === 'admin' && (task.createdBy === 'Admin' || !task.createdBy)) return true;
  return task.createdBy === name ||
    (task.assignedTo || []).includes(name) ||
    (task.sharedWith || []).includes(name);
}

app.get('/api/tasks', requireAuth, (req, res) => {
  const store = readStore();
  ensureTasks(store);
  const showArchived = req.query.archived === 'true';
  const list = Object.values(store.tasks)
    .filter(t => canSeeTask(t, req.session))
    .filter(t => showArchived ? t.archived : !t.archived)
    .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);
  res.json(list);
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const store = readStore();
  ensureTasks(store);
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const task = {
    id,
    title:       req.body.title       || 'Untitled',
    description: req.body.description || '',
    priority:    req.body.priority     || 'Medium',
    status:      req.body.status       || 'To Do',
    deadline:    req.body.deadline     || '',
    clientId:    req.body.clientId     || '',
    assignedTo:  Array.isArray(req.body.assignedTo) ? req.body.assignedTo : [],
    sharedWith:  Array.isArray(req.body.sharedWith) ? req.body.sharedWith : [],
    createdBy:   req.session.name      || 'Admin',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    archived:    false,
  };
  store.tasks[id] = task;
  logActivity(store, req, 'Task created', { details: task.title });
  writeStore(store);
  res.json(task);
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureTasks(store);
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (!canSeeTask(task, req.session)) return res.status(403).json({ error: 'Forbidden' });
  const allowed = ['title','description','priority','status','deadline','clientId','assignedTo','sharedWith','archived'];
  allowed.forEach(k => { if (req.body[k] !== undefined) task[k] = req.body[k]; });
  task.updatedAt = new Date().toISOString();
  store.tasks[req.params.id] = task;
  logActivity(store, req, 'Task updated', { details: task.title });
  writeStore(store);
  res.json(task);
});

app.post('/api/tasks/:id/comments', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const store = readStore();
  ensureTasks(store);
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (!canSeeTask(task, req.session)) return res.status(403).json({ error: 'Forbidden' });
  task.comments = task.comments || [];
  const comment = {
    id: 'cmt_' + Date.now(),
    text: text.trim(),
    author: req.session.name || 'Team',
    ts: new Date().toISOString(),
  };
  task.comments.push(comment);
  task.updatedAt = new Date().toISOString();
  store.tasks[req.params.id] = task;
  writeStore(store);
  res.json({ comment, task });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureTasks(store);
  const task = store.tasks[req.params.id];
  if (!task) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.session.role === 'admin';
  if (!isAdmin && task.createdBy !== (req.session.name || '')) return res.status(403).json({ error: 'Forbidden' });
  delete store.tasks[req.params.id];
  logActivity(store, req, 'Task deleted', { details: task.title });
  writeStore(store);
  res.json({ ok: true });
});

// ── Growth (Gathr Grow reporting/scoreboards) ─────────────────────────────────
// Self-contained: its own client roster + per-client data blob, isolated from
// the main CRM clients/tasks so it can't disrupt the rest of the app.
function ensureGrowth(store) {
  if (!store.growth) store.growth = { clients: [], data: {} };
  if (!store.growth.clients) store.growth.clients = [];
  if (!store.growth.data) store.growth.data = {};
}
function freshGrowthData() {
  return { board: null, periods: [], weeks: {}, fees: {}, notes: {} };
}

app.get('/api/growth/clients', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  res.json(store.growth.clients);
});

app.post('/api/growth/clients', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  const { name, business, currency, fee, people } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Client name required' });
  const id = 'gc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const client = {
    id, name: name.trim(),
    business: business || '',
    currency: currency || '£',
    fee: (fee === null || fee === undefined || isNaN(fee)) ? null : Number(fee),
    people: Array.isArray(people) ? people : [],
  };
  store.growth.clients.push(client);
  store.growth.data[id] = freshGrowthData();
  writeStore(store);
  res.json(client);
});

app.put('/api/growth/clients/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  const client = store.growth.clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'business', 'currency', 'fee', 'people'];
  allowed.forEach(k => { if (req.body[k] !== undefined) client[k] = req.body[k]; });
  writeStore(store);
  res.json(client);
});

app.delete('/api/growth/clients/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  store.growth.clients = store.growth.clients.filter(c => c.id !== req.params.id);
  delete store.growth.data[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});

app.get('/api/growth/data/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  res.json(store.growth.data[req.params.id] || freshGrowthData());
});

app.put('/api/growth/data/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureGrowth(store);
  if (!store.growth.clients.some(c => c.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
  store.growth.data[req.params.id] = req.body || freshGrowthData();
  writeStore(store);
  res.json({ ok: true });
});

// ── Diagnostic (Scoreboard intake instrument + strategy PDF) ──────────────────
// Self-contained, like Growth: its own store, its own CRUD, no shared state
// with the main CRM clients so it can't disrupt anything else.
function ensureDiagnostic(store) {
  if (!store.diagnostic) store.diagnostic = { assessments: {} };
  if (!store.diagnostic.assessments) store.diagnostic.assessments = {};
}
app.get('/api/diagnostic/assessments', requireAuth, (req, res) => {
  const store = readStore();
  ensureDiagnostic(store);
  res.json(Object.values(store.diagnostic.assessments));
});
app.post('/api/diagnostic/assessments', requireAuth, (req, res) => {
  const store = readStore();
  ensureDiagnostic(store);
  const id = 'da_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const a = {
    id,
    businessName: req.body.businessName || '',
    contactName: req.body.contactName || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    answers: req.body.answers || {},
  };
  store.diagnostic.assessments[id] = a;
  writeStore(store);
  res.json(a);
});
app.put('/api/diagnostic/assessments/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureDiagnostic(store);
  if (!store.diagnostic.assessments[req.params.id]) return res.status(404).json({ error: 'Not found' });
  const a = { ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  store.diagnostic.assessments[req.params.id] = a;
  writeStore(store);
  res.json(a);
});
app.delete('/api/diagnostic/assessments/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureDiagnostic(store);
  delete store.diagnostic.assessments[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});
// ── Knowledge Base: business facts / SOPs the CRM (and its AI features) can
// pull from ─────────────────────────────────────────────────────────────────
// Self-contained, same isolation pattern as diagnostic: its own store slice,
// own CRUD, own tab. Docs are typed straight into the CRM (no Drive/export
// step) so they're always current, then getRelevantKnowledgeDocs() lets any
// AI prompt in this file pull in just the docs that matter for a given
// context instead of stuffing everything into every call.
function ensureKnowledge(store) {
  if (!store.knowledge) store.knowledge = { docs: {} };
  if (!store.knowledge.docs) store.knowledge.docs = {};
}

// Docs are edited with a small rich-text toolbar (bold/lists/headings/font)
// on the client, so content arrives as HTML. Strip anything dangerous
// before it's ever persisted — this is an admin-only tool, not a full
// sanitizer, just a safety net against a stray <script> tag.
function sanitizeDocHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}
// Flattens a doc's rich-text HTML into plain text for the AI prompt —
// keeps bullet/paragraph structure (as "- " lines and blank lines) but
// strips markup and decodes entities, so the model reads clean prose
// instead of raw tags.
function htmlToText(html) {
  return String(html || '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

app.get('/api/knowledge/docs', requireAuth, (req, res) => {
  const store = readStore();
  ensureKnowledge(store);
  res.json(Object.values(store.knowledge.docs).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
});
app.post('/api/knowledge/docs', requireAuth, (req, res) => {
  const store = readStore();
  ensureKnowledge(store);
  const id = 'kb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const now = new Date().toISOString();
  const doc = {
    id,
    title: req.body.title || 'Untitled',
    category: req.body.category || 'other', // 'services' | 'sops' | 'brand' | 'other'
    tags: req.body.tags || '', // organizational only now — matching reads the content itself, not tags
    content: sanitizeDocHtml(req.body.content || ''),
    alwaysInclude: !!req.body.alwaysInclude,
    createdAt: now,
    updatedAt: now,
  };
  store.knowledge.docs[id] = doc;
  writeStore(store);
  res.json(doc);
});
app.put('/api/knowledge/docs/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureKnowledge(store);
  const existing = store.knowledge.docs[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const doc = {
    ...existing,
    title: req.body.title ?? existing.title,
    category: req.body.category ?? existing.category,
    tags: req.body.tags ?? existing.tags,
    content: req.body.content != null ? sanitizeDocHtml(req.body.content) : existing.content,
    alwaysInclude: req.body.alwaysInclude != null ? !!req.body.alwaysInclude : !!existing.alwaysInclude,
    id: req.params.id,
    updatedAt: new Date().toISOString(),
  };
  store.knowledge.docs[req.params.id] = doc;
  writeStore(store);
  res.json(doc);
});
app.delete('/api/knowledge/docs/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureKnowledge(store);
  delete store.knowledge.docs[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});

const KEYWORD_STOPWORDS = new Set(['the','and','for','with','that','this','have','from','they','their','what','when','where','which','about','into','your','you','are','was','were','been','being','not','but','can','could','would','should','will','just','more','most','some','such','than','then','them','these','those','over','under','also','only','very','much','many','make','made','need','needs','needing','want','wants','like','get','gets','getting','has','had']);
// Pulls out the meaningful words from any free text — a client's own
// description of their problem, the practitioner type, a custom AI
// instruction — so knowledge lookups key off what's actually being asked
// rather than requiring someone to have pre-tagged the right doc.
function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(w => w.length >= 4 && !KEYWORD_STOPWORDS.has(w));
}

// Cheap relevance filter, not a real embeddings search: matches keywords
// pulled from the actual question/context (not from a doc's own tags —
// tags are for the team's own browsing/organization only) against each
// doc's title and full content, and always includes anything marked
// "always include". Capped by count and total characters so this can't
// blow out the prompt or the token budget of whatever calls it.
function getRelevantKnowledgeDocs(store, keywords, { maxDocs = 6, maxChars = 6000 } = {}) {
  ensureKnowledge(store);
  const kw = [...new Set((keywords || []).flatMap(k => extractKeywords(k)))];
  const docs = Object.values(store.knowledge.docs);
  const scored = docs.map(d => {
    const title = (d.title || '').toLowerCase();
    const body = htmlToText(d.content).toLowerCase();
    let score = d.alwaysInclude ? 1000 : 0; // always-included docs sort first, regardless of match
    kw.forEach(k => {
      if (title.includes(k)) score += 3;
      if (body.includes(k)) score += 1;
    });
    return { d, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocs);
  let used = 0;
  const picked = [];
  for (const { d } of scored) {
    if (used >= maxChars) break;
    const text = htmlToText(d.content);
    const chunk = text.slice(0, maxChars - used);
    picked.push({ title: d.title, category: d.category, content: chunk });
    used += chunk.length;
  }
  return picked;
}

// One-off maintenance action: clears the saved AI recommendation off every
// assessment (never touches the assessment itself or its answers) so the
// next "Generate strategy report" on each one does a genuine fresh AI pass
// instead of reusing whatever was cached under an older prompt/schema.
app.post('/api/diagnostic/clear-ai-cache', requireAuth, (req, res) => {
  const store = readStore();
  ensureDiagnostic(store);
  let cleared = 0;
  Object.values(store.diagnostic.assessments).forEach(a => {
    if (a.aiRecommendation) { delete a.aiRecommendation; cleared++; }
  });
  writeStore(store);
  res.json({ ok: true, cleared });
});

// ── Diagnostic: AI-sharpened recommendations (Claude) ────────────────────────
// The deterministic scoring engine in diagnostic.js (computeRecommendation /
// topThirtyDayActions) is the source of truth and always renders first — this
// is a best-effort enhancement layered on top, called async from the client.
// If there's no API key, or the call fails or times out, the client silently
// keeps the deterministic plan. Nothing about report generation depends on
// this succeeding.
let _anthropicClient;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}
function aiRecommendationSchema(serviceNames, channelKeys) {
  return {
    type: 'object',
    properties: {
      priority_summary: { type: 'string', description: "Two to three sentences summarizing your holistic read of this business's whole diagnostic — where it genuinely stands right now and what matters most. Reference their actual numbers, not generic advice." },
      field_best_practices: {
        type: 'array', items: { type: 'string' },
        description: "5 to 8 real, specific marketing tactics that the best, highest-performing practitioners in THIS EXACT profession (practitionerType, not just the broader compliance group) actually do — named platforms, habits, and proof formats, not generic advice. E.g. a chiropractor's list should differ from a psychologist's or a personal trainer's even though they may share a compliance group.",
      },
      channels: {
        type: 'array',
        description: `Exactly one entry for EVERY one of these channel keys, no more, no fewer, none skipped: ${channelKeys.join(', ')}.`,
        items: {
          type: 'object',
          properties: {
            channel_key: { type: 'string', enum: channelKeys },
            best_practices: {
              type: 'array', items: { type: 'string' },
              description: "4 to 6 genuinely current, specific marketing best practices for this exact channel, for this type of practitioner business — draw on real marketing knowledge for this field, not generic filler. Replaces this channel's 'what good looks like' list entirely.",
            },
            quick_win: { type: 'string', description: "A specific, free, doable-in-30-days action for THIS business on this channel, tailored to their actual score and gap here — concrete and a real step up from generic advice ('post more content' is not acceptable; name what to post, to whom, how often). Still write one even for a channel scored Strong — the client only shows it when relevant." },
            help_service: { type: 'string', enum: serviceNames, description: "Which ONE Gathr service is the smart fit for closing this specific gap. Reason about overlaps between services (see their notes) rather than a fixed one-to-one mapping — e.g. don't recommend a narrower service when a broader one that already includes that work is the better fit for this business's overall situation." },
            help_reason: { type: 'string', description: "One to two sentences on why this specific service is the smart fit here — name the ACTUAL deliverable from that service's 'deliverables' field that addresses this exact gap (e.g. for Speed to Reply, name the automations/instant-reply setup; for Show Rate, name the booking-reminder automation). Never write generic filler like a repeated blurb or a vague 'this service will help' — be concrete about what gets built." },
          },
          required: ['channel_key', 'best_practices', 'quick_win', 'help_service', 'help_reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['priority_summary', 'field_best_practices', 'channels'],
    additionalProperties: false,
  };
}
const DEFAULT_GATHR_SERVICES = [
  { name: 'Brand OS', price: '$4500', blurb: 'We set up your whole foundation.', notes: 'A comprehensive 120-day build covering every foundational gap, including the systems work Software Setup covers alone.' },
  { name: 'Ads Management', price: null, blurb: 'We run your ads and fill your funnel.', notes: 'Only makes sense once the foundation is in decent shape.' },
  { name: 'Software Setup', price: '$1500', blurb: 'We set up your systems, then hand you the keys.', notes: "The narrower, standalone version of the systems work also included inside Brand OS — fits when that's their one clear gap." },
  { name: 'Content', price: '$1000/$1500', blurb: 'We create your content, so you show up without the effort.', notes: 'For a content-specific gap on an otherwise healthy business.' },
];
app.post('/api/diagnostic/ai-recommendations', requireAuth, async (req, res) => {
  const client = getAnthropicClient();
  if (!client) return res.status(503).json({ error: 'AI recommendations are not configured (missing ANTHROPIC_API_KEY).' });
  const { context, customInstruction } = req.body || {};
  if (!context) return res.status(400).json({ error: 'Missing context' });
  const services = Array.isArray(context.gathrServices) && context.gathrServices.length ? context.gathrServices : DEFAULT_GATHR_SERVICES;
  const serviceNames = services.map(s => s.name);
  const channelKeys = Array.isArray(context.channels) && context.channels.length
    ? context.channels.map(c => c.key)
    : ['content', 'paidads', 'outreach', 'referrals', 'reviews', 'website', 'directories', 'capture', 'speed', 'followup', 'show', 'sales'];
  const knowledgeStore = readStore();
  // Keywords come from the actual question being answered here: what this
  // business does, who they serve, what they said their gap is, which
  // channels are in play, and (on a regenerate-with-instruction) the literal
  // instruction text — not from however a doc happens to be tagged.
  const knowledgeDocs = getRelevantKnowledgeDocs(knowledgeStore, [
    context.practitionerType, context.practitionerGroup, context.idealClient, context.mainOffer,
    context.biggestGapInOwnWords, customInstruction,
    ...channelKeys, ...(Array.isArray(context.channels) ? context.channels.map(c => c.label) : []),
  ]);
  const knowledgeSection = knowledgeDocs.length
    ? `\n\nInternal Gathr Grow knowledge (facts and SOPs the team has recorded, most relevant to this business first). Treat these as true and let them inform your thinking, but never copy a doc's wording into the report. Read each one, understand it, and write the point in your own plain sentences as part of the advice, the same way a strategist would absorb a briefing note and then talk about it in their own words:\n${knowledgeDocs.map(d => `${d.title} (${d.category}):\n${d.content}`).join('\n\n')}\n`
    : '';
  try {
    const prompt = `You are a senior marketing strategist for Gathr Grow, holistically rewriting the marketing-strategy report for a health/fitness/beauty practitioner business right after a diagnostic assessment.

Keep in mind the report's scores, funnel numbers, and structure are already fixed and correct — your job is ONLY to write the content that goes inside each channel's card (best practices, a quick win, which Gathr service helps) plus a field-specific best-practices list. Analyse the ENTIRE business context below holistically before writing anything — every channel's score together, the funnel numbers as a whole, client LTV against their target, and their own words on their biggest gap. Don't treat each channel in isolation.

Business context (JSON):
${JSON.stringify(context, null, 2)}

Each entry in "channels" is a marketing/sales function already scored 0-100 by a fixed rubric (higher = healthier), with a "weight" (its max points) and a "chip" status of Strong / Needs work / Missing / Too early (unmeasured). "practitionerType" is their exact profession (e.g. "chiro", "psychologist", "pt") — use this, not just the broader "practitionerGroup", when deciding what real high-performers in their specific field actually do. "fieldLowHangingFruit" lists a starting set of real, mostly-free tactics for their field (directories, booking platforms, proof formats) — treat it as a floor to build on, not the ceiling.

Gathr's actual services — read each one's "notes" (real overlaps between services — e.g. one already includes another's scope) AND "deliverables" (what actually gets built, week by week) carefully. Every "help_reason" must name a real deliverable from the matching service, never generic filler. Every "help_service" must be exactly one of these names, never invented:
${JSON.stringify(services, null, 2)}
${knowledgeSection}
Write:
- field_best_practices: 5 to 8 real, specific tactics that the best-performing practitioners in THIS EXACT profession actually do — go beyond fieldLowHangingFruit with genuine marketing knowledge for this specific field, not the broader compliance group it happens to share with other professions
- For EVERY channel listed (all of them, none skipped):
  - best_practices: what genuinely good execution of this specific channel looks like for this kind of practitioner business, from real marketing knowledge — not the generic advice a template would give
  - quick_win: one concrete, free, doable-in-30-days action tailored to THIS business's actual score and gap on this channel — specific enough that a solo practitioner could just go do it, not "improve your X"
  - help_service + help_reason: whichever one Gathr service is the smart fit, naming the actual deliverable that closes this specific gap (reasoning about the service overlaps above rather than a fixed mapping) — the "action" in quick_win must always be free and independent of any paid service

Be concrete and specific throughout, and write like a person talking to a colleague, not a report generator. Plain sentences only: no em dashes or en dashes, no semicolons used as a dash substitute, no "Label: description" or "Label - description" fragments, no bullet-speak crammed into one sentence. If a sentence needs a pause, use a period or "and"/"so"/"which means" instead of a dash. This should read like a strategist who actually looked at this business's numbers, not a template applied to every client. Reference the business's own numbers where it strengthens the case.${customInstruction ? `\n\nThe team has this additional instruction for you — follow it, but do not violate any rule above (still one entry per channel, still free quick wins, still real Gathr services and their actual deliverables, still plain human sentences with no dashes) unless the instruction explicitly says otherwise:\n"${String(customInstruction).slice(0, 1000)}"` : ''}`;
    // Cost-efficient model on purpose: Sonnet, not Opus, at low effort.
    // max_tokens is generous (16000) because this asks for one full entry
    // per channel (12 of them) plus field_best_practices in one response —
    // 8000 was cutting the response off mid-JSON on a real run: Anthropic
    // still bills the tokens generated before the cutoff, and the
    // truncated JSON then fails to parse, which is exactly the "it failed
    // AND used credits" report this is fixing. Streaming avoids the HTTP
    // timeout that a max_tokens this size would otherwise risk on a
    // non-streaming request.
    const stream = client.messages.stream({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: aiRecommendationSchema(serviceNames, channelKeys) } },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'max_tokens') {
      console.error('[AI recommendations] truncated: hit max_tokens before finishing the response');
      return res.status(502).json({ error: 'AI response was cut off (too long to finish)', detail: 'stop_reason: max_tokens' });
    }
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'No AI response', detail: `stop_reason: ${message.stop_reason}` });
    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (parseErr) {
      console.error('[AI recommendations] JSON.parse failed:', parseErr.message, '| stop_reason:', message.stop_reason);
      return res.status(502).json({ error: 'AI response was not valid JSON', detail: parseErr.message });
    }
    res.json(parsed);
  } catch (err) {
    // Log everything the SDK gives us — err.message alone hides the actual
    // cause (auth, bad request, rate limit) behind a generic string.
    console.error('[AI recommendations] failed:', err.status, err.name, err.message, err.error || '');
    // Temporarily echo the real reason back to the client too, so this can
    // be diagnosed from the browser's network tab without needing to pull
    // Railway logs. This is an authenticated internal-team endpoint only.
    res.status(502).json({ error: 'AI recommendation failed', detail: err.message, status: err.status || null });
  }
});

// ── Client CRUD ───────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, (req, res) => {
  const store = readStore();
  ensurePrograms(store);
  ensureAddons(store);
  ensureTeam(store);
  const list  = Object.values(store.clients || {})
    .map(shapeClient)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

app.post('/api/clients', requireAuth, (req, res) => {
  const store  = readStore();
  const client = shapeClient({ ...req.body, id: genId(), createdAt: new Date().toISOString() });
  store.clients         = store.clients || {};
  store.clients[client.id] = client;
  logActivity(store, req, 'Client created', { clientId: client.id, clientName: client.name, details: `Program: ${client.program || '—'}` });
  writeStore(store);
  res.json(client);
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const store    = readStore();
  const existing = store.clients?.[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const changes = [];
  const fields = { name:'Name', leadAssignee:'Lead Coach', techAssignee:'Tech', status:'Status', addOns:'Add-ons' };
  for (const [key, label] of Object.entries(fields)) {
    if (req.body[key] !== undefined && String(req.body[key]) !== String(existing[key] || ''))
      changes.push(`${label}: "${existing[key] || '—'}" → "${req.body[key]}"`);
  }
  // Track programs changes
  const oldProgs = (existing.programs || (existing.program ? [existing.program] : [])).join(', ') || '—';
  const newProgs = (req.body.programs || (req.body.program ? [req.body.program] : [])).join(', ') || '—';
  if (oldProgs !== newProgs) changes.push(`Programs: "${oldProgs}" → "${newProgs}"`);
  const updated  = shapeClient({ ...existing, ...req.body, id: req.params.id });
  store.clients[req.params.id] = updated;
  if (changes.length) logActivity(store, req, 'Client updated', { clientId: req.params.id, clientName: updated.name, details: changes.join(' | ') });
  writeStore(store);
  res.json(updated);
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const store = readStore();
  const client = store.clients?.[req.params.id];
  if (!client) return res.status(404).json({ error: 'Not found' });
  logActivity(store, req, 'Client deleted', { clientName: client.name, details: `Program: ${client.program || '—'}` });
  delete store.clients[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});

// ── Notes Log ─────────────────────────────────────────────────────────────────
app.post('/api/clients/:id/notes', requireAuth, (req, res) => {
  const { author, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Note text required' });
  const store  = readStore();
  const client = store.clients?.[req.params.id];
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.notesLog = [...(client.notesLog || []), {
    author: (author || 'Team').trim(),
    text:   text.trim(),
    ts:     new Date().toISOString(),
  }];
  store.clients[req.params.id] = client;
  logActivity(store, req, 'Note added', { clientId: req.params.id, clientName: client.name, details: text.trim().slice(0, 120) });
  writeStore(store);
  res.json(shapeClient(client));
});

// ── Local store per-client (activity log, old program checklist) ──────────────
app.get('/api/local', requireAuth, (req, res) => {
  const store  = readStore();
  const result = {};
  for (const [id, c] of Object.entries(store.clients || {})) {
    result[id] = { activityLog: c.activityLog || [], oldProgramChecklist: c.oldProgramChecklist || {} };
  }
  res.json(result);
});

app.get('/api/local/:clientId', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.json({});
  res.json({ activityLog: client.activityLog || [], oldProgramChecklist: client.oldProgramChecklist || {} });
});

app.put('/api/local/:clientId', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  Object.assign(client, req.body);
  store.clients[req.params.clientId] = client;
  writeStore(store);
  res.json({ activityLog: client.activityLog || [], oldProgramChecklist: client.oldProgramChecklist || {} });
});

// ── Checklist Notes ───────────────────────────────────────────────────────────
app.patch('/api/checklist-notes/:clientId', requireAuth, (req, res) => {
  const { week, itemId, note, status, programId } = req.body;
  if (!week || !itemId) return res.status(400).json({ error: 'week and itemId required' });
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  const shaped = shapeClient(client);
  const pId = programId || shaped.programs[0] || '';
  shaped.checklistNotes[pId] = shaped.checklistNotes[pId] || {};
  shaped.checklistNotes[pId][week] = shaped.checklistNotes[pId][week] || {};
  shaped.checklistNotes[pId][week][itemId] = {
    note: note || '', status: status || 'pending',
    updatedAt: new Date().toISOString(), author: req.session.name || 'Team',
  };
  Object.assign(client, { checklistNotes: shaped.checklistNotes });
  store.clients[req.params.clientId] = client;
  logActivity(store, req, 'Task note saved', { clientId: req.params.clientId, clientName: client.name, details: `${pId} · Week ${week} · ${status || 'pending'}${note ? ': ' + note.slice(0,80) : ''}` });
  writeStore(store);
  res.json({ checklistNotes: shaped.checklistNotes });
});

app.patch('/api/checklist-assign/:clientId', requireAuth, (req, res) => {
  const { week, itemId, assignee, programId } = req.body;
  if (!week || !itemId) return res.status(400).json({ error: 'week and itemId required' });
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  const shaped = shapeClient(client);
  const pId = programId || shaped.programs[0] || '';
  shaped.checklistAssignees[pId] = shaped.checklistAssignees[pId] || {};
  shaped.checklistAssignees[pId][week] = shaped.checklistAssignees[pId][week] || {};
  shaped.checklistAssignees[pId][week][itemId] = assignee || '';
  Object.assign(client, { checklistAssignees: shaped.checklistAssignees });
  store.clients[req.params.clientId] = client;
  writeStore(store);
  res.json({ checklistAssignees: shaped.checklistAssignees });
});

// ── Checklists (local) ────────────────────────────────────────────────────────
app.get('/api/clients/:id/checklist/:week', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.id];
  if (!client) return res.json({ fields: {}, recordId: null });
  const shaped  = shapeClient(client);
  const week    = parseInt(req.params.week);
  const pId     = req.query.program || shaped.programs[0] || '';
  const fields  = (shaped.checklists[pId] || {})[week] || {};
  res.json({ fields, recordId: req.params.id, programId: pId });
});

app.patch('/api/checklist/:week/:clientId', requireAuth, (req, res) => {
  const { field, value, label, programId } = req.body;
  const week   = parseInt(req.params.week);
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  const shaped = shapeClient(client);
  const pId    = programId || shaped.programs[0] || '';
  shaped.checklists[pId]        = shaped.checklists[pId] || {};
  shaped.checklists[pId][week]  = shaped.checklists[pId][week] || {};
  shaped.checklists[pId][week][field] = !!value;
  Object.assign(client, { checklists: shaped.checklists });
  store.clients[req.params.clientId] = client;
  logActivity(store, req, value ? 'Task checked' : 'Task unchecked', { clientId: req.params.clientId, clientName: client.name, details: `${pId} · Week ${week} — ${label || field}` });
  writeStore(store);
  res.json({ fields: shaped.checklists[pId][week], recordId: req.params.clientId, programId: pId });
});

// Mark all checklist items for a program as complete
app.post('/api/clients/:id/complete-program/:programId', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.id];
  if (!client) return res.status(404).json({ error: 'Not found' });
  const pId    = req.params.programId;
  const prog   = store.programs?.[pId];
  if (!prog?.weeks) return res.status(400).json({ error: 'Program not found' });

  const shaped = shapeClient(client);
  shaped.checklists[pId] = shaped.checklists[pId] || {};
  const completed = {};
  Object.entries(prog.weeks).forEach(([wk, def]) => {
    const week = parseInt(wk);
    shaped.checklists[pId][week] = shaped.checklists[pId][week] || {};
    (def.items || []).forEach(item => {
      shaped.checklists[pId][week][item.id] = true;
      completed[`${week}:${item.id}`] = true;
    });
  });
  Object.assign(client, { checklists: shaped.checklists });
  store.clients[req.params.id] = client;
  logActivity(store, req, 'Program completed', { clientId: req.params.id, clientName: client.name, details: `All tasks auto-checked for ${pId}` });
  writeStore(store);
  res.json({ checklists: shaped.checklists[pId], programId: pId });
});

// ── Add-ons CRUD ──────────────────────────────────────────────────────────────
app.get('/api/addons', requireAuth, (req, res) => {
  const store = readStore();
  ensureAddons(store);
  writeStore(store);
  res.json(store.addons);
});

app.post('/api/addons', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const store = readStore();
  ensureAddons(store);
  if (store.addons[name]) return res.status(409).json({ error: 'Add-on already exists' });
  const addon = { id: name, name, color: color || '#8A7A6E', deliverables: [] };
  store.addons[name] = addon;
  writeStore(store);
  res.json(addon);
});

app.put('/api/addons/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureAddons(store);
  const oldId = decodeURIComponent(req.params.id);
  const addon = store.addons[oldId];
  if (!addon) return res.status(404).json({ error: 'Add-on not found' });
  const { name, color, deliverables } = req.body;
  const newName = name?.trim() || oldId;
  const updated = { ...addon, id: newName, name: newName, color: color || addon.color, deliverables: deliverables || addon.deliverables };
  if (newName !== oldId) {
    delete store.addons[oldId];
    for (const c of Object.values(store.clients || {})) {
      if (c.addOns?.includes(oldId)) c.addOns = c.addOns.replace(oldId, newName);
    }
  }
  store.addons[newName] = updated;
  writeStore(store);
  res.json(updated);
});

app.delete('/api/addons/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensureAddons(store);
  const id = decodeURIComponent(req.params.id);
  if (!store.addons[id]) return res.status(404).json({ error: 'Not found' });
  delete store.addons[id];
  writeStore(store);
  res.json({ ok: true });
});

app.patch('/api/addon-checklist-notes/:clientId', requireAuth, (req, res) => {
  const { addonName, itemId, note, status } = req.body;
  if (!addonName || !itemId) return res.status(400).json({ error: 'addonName and itemId required' });
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.addonChecklistNotes = client.addonChecklistNotes || {};
  client.addonChecklistNotes[addonName] = client.addonChecklistNotes[addonName] || {};
  client.addonChecklistNotes[addonName][itemId] = {
    note:      note   || '',
    status:    status || 'pending',
    updatedAt: new Date().toISOString(),
    author:    req.session.name || 'Team',
  };
  store.clients[req.params.clientId] = client;
  logActivity(store, req, 'Add-on task note saved', { clientId: req.params.clientId, clientName: client.name, details: `${addonName} · ${itemId} · ${status || 'pending'}${note ? ': ' + note.slice(0,80) : ''}` });
  writeStore(store);
  res.json({ addonChecklistNotes: client.addonChecklistNotes });
});

app.patch('/api/addon-checklist/:clientId', requireAuth, (req, res) => {
  const { addonName, itemId, value, label } = req.body;
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.addonChecklists = client.addonChecklists || {};
  client.addonChecklists[addonName] = client.addonChecklists[addonName] || {};
  client.addonChecklists[addonName][itemId] = !!value;
  store.clients[req.params.clientId] = client;
  logActivity(store, req, value ? 'Add-on task checked' : 'Add-on task unchecked', { clientId: req.params.clientId, clientName: client.name, details: `${addonName} — ${label || itemId}` });
  writeStore(store);
  res.json({ addonChecklists: client.addonChecklists });
});

// ── Programs CRUD ─────────────────────────────────────────────────────────────
app.get('/api/programs', requireAuth, (req, res) => {
  const store = readStore();
  ensurePrograms(store);
  writeStore(store);
  res.json(store.programs);
});

app.post('/api/programs', requireAuth, (req, res) => {
  const { name, price, color, duration } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const store = readStore();
  ensurePrograms(store);
  if (store.programs[name]) return res.status(409).json({ error: 'Program already exists' });
  const prog = { id: name, name, price: price || '', color: color || '#8A7A6E', duration: parseInt(duration) || 4, weeks: {} };
  for (let w = 1; w <= prog.duration; w++) {
    prog.weeks[w] = { title: `Week ${w}`, phase: '', items: [] };
  }
  store.programs[name] = prog;
  writeStore(store);
  res.json(prog);
});

app.put('/api/programs/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensurePrograms(store);
  const oldId = decodeURIComponent(req.params.id);
  const prog  = store.programs[oldId];
  if (!prog) return res.status(404).json({ error: 'Program not found' });

  const { name, price, color, duration, weeks } = req.body;
  const newName = name?.trim() || oldId;
  const newDur  = parseInt(duration) || prog.duration;

  // Ensure all weeks exist up to new duration
  const existingWeeks = weeks || prog.weeks || {};
  const merged = {};
  for (let w = 1; w <= newDur; w++) {
    merged[w] = existingWeeks[w] || { title: `Week ${w}`, phase: '', items: [] };
  }

  const updated = { ...prog, name: newName, id: newName, price: price ?? prog.price, color: color || prog.color, duration: newDur, weeks: merged };

  // Handle rename
  if (newName !== oldId) {
    delete store.programs[oldId];
    // Update all clients using this program
    for (const c of Object.values(store.clients || {})) {
      if (c.program === oldId) c.program = newName;
    }
  }
  store.programs[newName] = updated;
  writeStore(store);
  res.json(updated);
});

app.delete('/api/programs/:id', requireAuth, (req, res) => {
  const store = readStore();
  ensurePrograms(store);
  const id = decodeURIComponent(req.params.id);
  if (!store.programs[id]) return res.status(404).json({ error: 'Not found' });
  const inUse = Object.values(store.clients || {}).filter(c => c.program === id).map(c => c.name);
  if (inUse.length) return res.status(409).json({ error: `In use by: ${inUse.join(', ')}` });
  delete store.programs[id];
  writeStore(store);
  res.json({ ok: true });
});

// ── Calendar entries ─────────────────────────────────────────────────────────
app.get('/api/calendar', requireAuth, (req, res) => {
  const store   = readStore();
  const entries = Object.values(store.calendarEntries || {});
  const { from, to } = req.query;
  const isAdmin = req.session.role === 'admin';
  let result = entries;
  if (from) result = result.filter(e => e.date >= from);
  if (to)   result = result.filter(e => e.date <= to);
  if (!isAdmin) result = result.filter(e => e.userId === req.session.userId);
  result.sort((a, b) => a.date.localeCompare(b.date));
  res.json(result);
});

app.post('/api/calendar', requireAuth, (req, res) => {
  const { date, text, type } = req.body;
  if (!date || !text?.trim()) return res.status(400).json({ error: 'date and text required' });
  const store = readStore();
  if (!store.calendarEntries) store.calendarEntries = {};
  const id = 'ce_' + Date.now();
  const entry = {
    id, date, text: text.trim(),
    type: type || 'log',
    userId:   req.session.userId || 'admin',
    userName: req.session.name  || 'Admin',
    createdAt: new Date().toISOString(),
  };
  store.calendarEntries[id] = entry;
  logActivity(store, req, 'Calendar entry added', { details: `${date}: ${text.trim().slice(0,100)}` });
  writeStore(store);
  res.json(entry);
});

app.delete('/api/calendar/:id', requireAuth, (req, res) => {
  const store = readStore();
  const entry = store.calendarEntries?.[req.params.id];
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.session.role === 'admin';
  if (!isAdmin && entry.userId !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
  delete store.calendarEntries[req.params.id];
  writeStore(store);
  res.json({ ok: true });
});

// ── Activity Log ─────────────────────────────────────────────────────────────
app.get('/api/activity', requireAuth, (req, res) => {
  const store = readStore();
  const log = (store.activityLog || []).slice(0, 500);
  res.json(log);
});

app.get('/api/activity/user/:userId', requireAuth, (req, res) => {
  const store = readStore();
  const log = (store.activityLog || []).filter(e => e.userId === req.params.userId).slice(0, 300);
  res.json(log);
});

app.get('/api/activity/client/:clientId', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.json([]);
  res.json((client.activityLog || []).slice(0, 300));
});

// ── Backup & Restore ──────────────────────────────────────────────────────────
app.get('/api/backup', requireAuth, (req, res) => {
  const store    = readStore();
  const filename = `gathr-backup-${new Date().toISOString().split('T')[0]}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(store, null, 2));
});

app.post('/api/restore', requireAuth, (req, res) => {
  try {
    const backup = req.body;
    if (!backup.clients) return res.status(400).json({ error: 'Invalid backup — missing clients data' });
    writeStore(backup);
    res.json({ ok: true, clientCount: Object.keys(backup.clients).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── One-time import from Airtable ─────────────────────────────────────────────
app.post('/api/import-from-airtable', requireAuth, async (req, res) => {
  const pat    = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) return res.status(400).json({ error: 'AIRTABLE_PAT and AIRTABLE_BASE_ID env vars required' });

  try {
    const Airtable = require('airtable');
    const base     = new Airtable({ apiKey: pat }).base(baseId);
    const records  = await base(process.env.AIRTABLE_CLIENTS_TABLE || 'Clients').select().all();

    const store = readStore();
    store.clients = store.clients || {};
    let imported = 0;

    for (const rec of records) {
      const f        = rec.fields;
      const id       = rec.id;
      const existing = store.clients[id] || {};

      store.clients[id] = shapeClient({
        ...existing,
        id,
        name:               f['Client Name']        || '',
        businessName:       f['Business Name']       || '',
        email:              f['Email']               || '',
        phone:              f['Phone']               || '',
        instagram:          f['Instagram']           || '',
        otherSocials:       f['Other Socials']       || '',
        website:            f['Website']             || '',
        business:           f['Business']            || '',
        program:            f['Package']             || '',
        status:             f['Status']              || '',
        currentWeek:        f['Current Week']        || 1,
        startDate:          f['Start Date']          || '',
        leadAssignee:       f['Assigned Coach']      || '',
        techAssignee:       f['Assigned Tech Lead']  || f['Assigned Tech'] || '',
        brandDirection:     f['Brand Direction']     || '',
        servicesAndPricing: f['Services & Pricing']  || '',
        targetAudience:     f['Target Audience']     || '',
        goals:              f['Goals']               || '',
        logoUrl:            f['Logo URL']            || '',
        currentFollowers:   f['Current Followers']   || '',
        filmingAvailability:f['Filming Availability'] || '',
        existingContent:    f['Existing Content']    || '',
        heardAboutUs:       f['Heard About Us']      || '',
        anythingElse:       f['Anything Else']       || '',
        notes:              f['Notes']               || '',
        notesLog:           existing.notesLog?.length ? existing.notesLog : parseNotesLog(f['Notes Log']),
        addOns:             f['Add ons'] || f['Add-ons'] || existing.addOns || '',
        intakeSubmitted:    f['Intake Submitted']    || '',
        activityLog:        existing.activityLog     || [],
        oldProgramChecklist:existing.oldProgramChecklist || {},
        checklists:         existing.checklists      || {},
        createdAt:          existing.createdAt       || rec._rawJson?.createdTime || new Date().toISOString(),
      });
      imported++;
    }

    writeStore(store);
    res.json({ ok: true, imported });
  } catch (e) {
    console.error('import-from-airtable', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Old Program migration from another Airtable base ─────────────────────────
const OLD_FIELD_MAP = {
  'Intake Call Completed': 'ICC', 'Brand Assets Received': 'BAR',
  'Social Links Received': 'SLR', 'Domain Access Received': 'DAR',
  'Content Questionnaire Received': 'CQR', 'Funnel Built': 'FB',
  'Funnel Approved': 'FA', 'Domain Connected': 'DC',
  'Business Number Purchased': 'BNP', 'Sending Domain Connected': 'SDC',
  'Calendar Connected': 'CC', 'Pipelines Created': 'PC',
  'Automations Created': 'AC', 'Email Templates Loaded': 'ETL',
  'Booking Calendar Created': 'BCC', 'Integrations Connected': 'ICN',
  'Bio Optimized': 'BO', 'CTA Finalized': 'CTAF',
  'Pinned Posts Planned': 'PPP', 'Content Strategy Completed': 'CSC',
  'Filming Session Scheduled': 'FSS', 'First Content Batch Delivered': 'FCBD',
  'Revision Call Completed': 'RCC', 'Client Training Completed': 'CTC',
  'Playbook Sent': 'PS', 'Weekly Tech Call Assigned': 'WTCA',
  'Client Added To Support Group': 'CASG', 'Internal QA Completed': 'IQAC',
  'Ready For Launch': 'RFL', 'Launch Completed': 'LC',
};

app.post('/api/migrate-old-program', requireAuth, async (req, res) => {
  let { oldBaseId } = req.body;
  if (!oldBaseId) return res.status(400).json({ error: 'oldBaseId required' });
  const baseMatch = oldBaseId.match(/app[A-Za-z0-9]+/);
  if (!baseMatch) return res.status(400).json({ error: 'Invalid base ID' });
  oldBaseId = baseMatch[0];

  const norm = s => {
    if (Array.isArray(s)) s = s[0];
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, ' ');
  };

  try {
    const Airtable = require('airtable');
    const oldBase  = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(oldBaseId);
    const oldRecords = await oldBase('Onboarding & Build').select().all();

    const store = readStore();
    store.clients = store.clients || {};

    // Build name index
    const byName = {};
    for (const [id, c] of Object.entries(store.clients)) {
      byName[norm(c.name)] = id;
    }

    const results = { updated: [], notFound: [] };

    for (const oldRec of oldRecords) {
      const rawName = oldRec.fields['Clients Name'] || oldRec.fields['Client Name'] || '';
      const oldName = Array.isArray(rawName) ? rawName[0] : rawName;
      if (!oldName) continue;

      const clientId = byName[norm(oldName)];
      if (!clientId) { results.notFound.push(String(oldName)); continue; }

      const checklist = {};
      for (const [fieldName, key] of Object.entries(OLD_FIELD_MAP)) {
        checklist[key] = !!oldRec.fields[fieldName];
      }

      store.clients[clientId].program            = 'Old Program';
      store.clients[clientId].oldProgramChecklist = checklist;
      results.updated.push(String(oldName));
    }

    writeStore(store);
    res.json({ ok: true, updated: results.updated, notFound: results.notFound });
  } catch (e) {
    console.error('migrate-old-program', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Public Intake Form ────────────────────────────────────────────────────────
app.post('/api/intake', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name || !b.email) return res.status(400).json({ error: 'Name and email required' });

    const store  = readStore();
    const client = shapeClient({
      name:               b.name,
      businessName:       b.businessName       || '',
      email:              b.email,
      phone:              b.phone              || '',
      instagram:          b.instagram          || '',
      otherSocials:       b.otherSocials       || '',
      website:            b.website            || '',
      brandDirection:     b.brandDirection     || '',
      servicesAndPricing: b.servicesAndPricing || '',
      targetAudience:     b.targetAudience     || '',
      goals:              b.goals              || '',
      logoUrl:            b.logoUrl            || '',
      filmingAvailability:b.filmingAvailability|| '',
      existingContent:    b.existingContent    || '',
      heardAboutUs:       b.heardAboutUs       || '',
      anythingElse:       b.anythingElse       || '',
      status:             'New Client',
      intakeSubmitted:    new Date().toISOString().split('T')[0],
      currentWeek:        1,
    });

    store.clients = store.clients || {};
    store.clients[client.id] = client;
    writeStore(store);
    res.json({ ok: true, id: client.id });
  } catch (e) {
    console.error('POST /api/intake', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Static ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/intake', (req, res) => res.sendFile(path.join(__dirname, 'public', 'intake.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// One-time cleanup: "Glaiza" was carried on Growth clients/periods as a
// standing coach on every account — strip her out everywhere she appears.
// Idempotent (safe to run on every boot; no-ops once she's gone).
function pruneGrowthPerson(store, name) {
  if (!store.growth) return false;
  const target = name.trim().toLowerCase();
  let changed = false;
  (store.growth.clients || []).forEach(c => {
    if (Array.isArray(c.people) && c.people.some(n => (n || '').trim().toLowerCase() === target)) {
      c.people = c.people.filter(n => (n || '').trim().toLowerCase() !== target);
      changed = true;
    }
  });
  Object.values(store.growth.data || {}).forEach(d => {
    (d.periods || []).forEach(p => {
      if (Array.isArray(p.people)) {
        const before = p.people.length;
        p.people = p.people.filter(pn => (pn.name || '').trim().toLowerCase() !== target);
        if (p.people.length !== before) changed = true;
      }
    });
  });
  return changed;
}

const PORT = process.env.PORT || 3001;
// Seed admin user on startup
(function() {
  const store = readStore();
  ensureAdminUser(store);
  if (pruneGrowthPerson(store, 'Glaiza')) console.log('[migration] Removed Glaiza from Growth clients/periods');
  writeStore(store);
})();

app.listen(PORT, () => console.log(`Gathr Grow → http://localhost:${PORT}`));
