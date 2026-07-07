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
      13:{title:'Week 13',phase:'Phase 4 · Custom Branded Website',items:[]},
      14:{title:'Week 14',phase:'Phase 4 · Custom Branded Website',items:[]},
      15:{title:'Week 15',phase:'Phase 4 · Custom Branded Website',items:[]},
      16:{title:'Week 16',phase:'Phase 4 · Custom Branded Website',items:[]},
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
    program:            c.program            || '',
    status:             c.status             || '',
    currentWeek:        c.currentWeek        || 1,
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
    oldProgramChecklist:c.oldProgramChecklist|| {},
    checklists:         c.checklists         || {},
    addonChecklists:    c.addonChecklists    || {},
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
  res.json(store.team || []);
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
  store.team = store.team.filter(m => m.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
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
  writeStore(store);
  res.json(client);
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const store    = readStore();
  const existing = store.clients?.[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const updated  = shapeClient({ ...existing, ...req.body, id: req.params.id });
  store.clients[req.params.id] = updated;
  writeStore(store);
  res.json(updated);
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const store = readStore();
  if (!store.clients?.[req.params.id]) return res.status(404).json({ error: 'Not found' });
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

// ── Checklists (local) ────────────────────────────────────────────────────────
app.get('/api/clients/:id/checklist/:week', requireAuth, (req, res) => {
  const store  = readStore();
  const client = store.clients?.[req.params.id];
  if (!client) return res.json({ fields: {}, recordId: null });
  const week   = parseInt(req.params.week);
  const fields = (client.checklists || {})[week] || {};
  // Return client id as recordId so PATCH knows which client to update
  res.json({ fields, recordId: req.params.id });
});

app.patch('/api/checklist/:week/:clientId', requireAuth, (req, res) => {
  const { field, value } = req.body;
  const week   = parseInt(req.params.week);
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.checklists         = client.checklists || {};
  client.checklists[week]   = client.checklists[week] || {};
  client.checklists[week][field] = !!value;
  store.clients[req.params.clientId] = client;
  writeStore(store);
  res.json({ fields: client.checklists[week], recordId: req.params.clientId });
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

app.patch('/api/addon-checklist/:clientId', requireAuth, (req, res) => {
  const { addonName, itemId, value } = req.body;
  const store  = readStore();
  const client = store.clients?.[req.params.clientId];
  if (!client) return res.status(404).json({ error: 'Not found' });
  client.addonChecklists = client.addonChecklists || {};
  client.addonChecklists[addonName] = client.addonChecklists[addonName] || {};
  client.addonChecklists[addonName][itemId] = !!value;
  store.clients[req.params.clientId] = client;
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

const PORT = process.env.PORT || 3001;
// Seed admin user on startup
(function() {
  const store = readStore();
  ensureAdminUser(store);
  writeStore(store);
})();

app.listen(PORT, () => console.log(`Gathr Grow → http://localhost:${PORT}`));
