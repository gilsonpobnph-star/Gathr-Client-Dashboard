require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

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

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { clients: {}, meta: { version: '2.0', createdAt: new Date().toISOString() } }; }
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

app.post('/api/login', (req, res) => {
  if (req.body.password === PASS) { req.session.authenticated = true; res.json({ ok: true }); }
  else res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => { res.json({ authenticated: !!req.session.authenticated }); });
app.get('/api/team', requireAuth, (req, res) => { res.json(TEAM_MEMBERS); });

// ── Client CRUD ───────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, (req, res) => {
  const store = readStore();
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
app.listen(PORT, () => console.log(`Gathr Grow → http://localhost:${PORT}`));
