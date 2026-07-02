require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Airtable = require('airtable');
const path = require('path');

const app = express();
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'gathr-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 },
}));

const PASS = process.env.DASHBOARD_PASSWORD || 'GathrGrowAdmin';
const TEAM_MEMBERS = (process.env.TEAM_MEMBERS || 'Gil,Glaiza').split(',').map(s => s.trim());

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const CLIENTS_TABLE = process.env.AIRTABLE_CLIENTS_TABLE || 'Clients';

// Second Airtable base (Gathr Space)
const GATHR_SPACE_BASE_ID = process.env.GATHR_SPACE_BASE_ID || 'appwjC3yyUqr6dMPr';
const GATHR_SPACE_TABLE   = process.env.GATHR_SPACE_TABLE   || 'tblYUmfe6voFI2slO';
const GATHR_SPACE_VIEW    = process.env.GATHR_SPACE_VIEW    || 'viwoDRKVRA4DhvI6j';
const spaceBase = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(GATHR_SPACE_BASE_ID);

const CHECKLIST_TABLES = { 1: 'P1 W1', 2: 'P1 W2', 3: 'P1 W3', 4: 'P1 W4' };
const CHECKLIST_FIELDS = {
  1: ['IF', 'BDC', 'CFS', 'WIGM', 'BPCL'],
  2: ['CRM&F', 'Auto', 'Cal', 'Dom', 'BPN#', 'Offer', 'FOS'],
  3: ['RSB', 'ACF', 'FCL'],
  4: ['1:1 CRMT', 'SOP&P', 'SMM (W4-8)', 'Launch'],
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/login', (req, res) => {
  if (req.body.password === PASS) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNotesLog(val) {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed;
    // Plain text — wrap as legacy note
    return [{ author: 'System', text: String(val), ts: new Date(0).toISOString() }];
  } catch {
    return [{ author: 'System', text: String(val), ts: new Date(0).toISOString() }];
  }
}

function shapeClient(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    name: f['Client Name'] || '',
    businessName: f['Business Name'] || '',
    email: f['Email'] || '',
    phone: f['Phone'] || '',
    instagram: f['Instagram'] || '',
    otherSocials: f['Other Socials'] || '',
    website: f['Website'] || '',
    business: f['Business'] || '',
    program: f['Package'] || '',
    status: f['Status'] || '',
    currentWeek: f['Current Week'] || 1,
    startDate: f['Start Date'] || '',
    leadAssignee: f['Assigned Coach'] || '',
    techAssignee: f['Assigned Tech'] || '',
    brandDirection: f['Brand Direction'] || '',
    servicesAndPricing: f['Services & Pricing'] || '',
    targetAudience: f['Target Audience'] || '',
    goals: f['Goals'] || '',
    logoUrl: f['Logo URL'] || '',
    currentFollowers: f['Current Followers'] || '',
    filmingAvailability: f['Filming Availability'] || '',
    existingContent: f['Existing Content'] || '',
    heardAboutUs: f['Heard About Us'] || '',
    anythingElse: f['Anything Else'] || '',
    notes: f['Notes'] || '',
    notesLog: parseNotesLog(f['Notes Log']),
    intakeSubmitted: f['Intake Submitted'] || '',
    createdAt: rec._rawJson?.createdTime || '',
  };
}

const FIELD_MAP = {
  name: 'Client Name',
  businessName: 'Business Name',
  email: 'Email',
  phone: 'Phone',
  instagram: 'Instagram',
  otherSocials: 'Other Socials',
  website: 'Website',
  program: 'Package',
  status: 'Status',
  currentWeek: 'Current Week',
  startDate: 'Start Date',
  leadAssignee: 'Assigned Coach',
  techAssignee: 'Assigned Tech',
  brandDirection: 'Brand Direction',
  servicesAndPricing: 'Services & Pricing',
  targetAudience: 'Target Audience',
  goals: 'Goals',
  logoUrl: 'Logo URL',
  currentFollowers: 'Current Followers',
  filmingAvailability: 'Filming Availability',
  existingContent: 'Existing Content',
  heardAboutUs: 'Heard About Us',
  anythingElse: 'Anything Else',
  notes: 'Notes',
};

// ── Client Routes ─────────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const records = await base(CLIENTS_TABLE).select({
      sort: [{ field: 'Client Name', direction: 'asc' }],
    }).all();
    res.json(records.map(shapeClient));
  } catch (e) {
    console.error('GET /api/clients', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    const fields = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (FIELD_MAP[key] && val !== undefined) {
        fields[FIELD_MAP[key]] = val;
      }
    }
    const [updated] = await base(CLIENTS_TABLE).update([{ id: req.params.id, fields }]);
    res.json(shapeClient(updated));
  } catch (e) {
    console.error('PUT /api/clients', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Notes Log Route ───────────────────────────────────────────────────────────

app.post('/api/clients/:id/notes', requireAuth, async (req, res) => {
  try {
    const { author, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text required' });

    // Read current notes log
    const rec = await base(CLIENTS_TABLE).find(req.params.id);
    const existing = parseNotesLog(rec.fields['Notes Log']);

    const newNote = {
      author: (author || 'Team').trim(),
      text: text.trim(),
      ts: new Date().toISOString(),
    };

    const updated_log = [...existing, newNote];

    const [updated] = await base(CLIENTS_TABLE).update([{
      id: req.params.id,
      fields: { 'Notes Log': JSON.stringify(updated_log) },
    }]);

    res.json(shapeClient(updated));
  } catch (e) {
    console.error('POST /api/notes', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/team', requireAuth, (req, res) => {
  res.json(TEAM_MEMBERS);
});

// ── Gathr Space Members ───────────────────────────────────────────────────────

app.get('/api/gathr-members', requireAuth, async (req, res) => {
  try {
    const records = await spaceBase(GATHR_SPACE_TABLE).select({
      view: GATHR_SPACE_VIEW,
    }).all();

    // Return raw fields so the frontend can pick what's applicable
    const members = records.map(r => ({
      id: r.id,
      fields: r.fields,
    }));

    res.json(members);
  } catch (e) {
    console.error('GET /api/gathr-members', e.message);
    // Non-fatal — return empty if base access denied
    res.json([]);
  }
});

// ── Checklist Routes ──────────────────────────────────────────────────────────

app.get('/api/clients/:id/checklist/:week', requireAuth, async (req, res) => {
  try {
    const week = parseInt(req.params.week);
    const tableName = CHECKLIST_TABLES[week];
    if (!tableName) return res.json({ fields: {}, recordId: null });

    const clientRec = await base(CLIENTS_TABLE).find(req.params.id);
    const clientName = clientRec.fields['Client Name'];
    if (!clientName) return res.json({ fields: {}, recordId: null });

    // Use FIND for robustness with linked record fields
    const rows = await base(tableName).select({
      filterByFormula: `FIND("${clientName.replace(/"/g, '\\"')}", {Client Name})`,
      maxRecords: 1,
    }).firstPage();

    if (!rows.length) return res.json({ fields: {}, recordId: null });

    const fields = {};
    const checkFields = CHECKLIST_FIELDS[week] || [];
    for (const f of checkFields) {
      fields[f] = !!rows[0].fields[f];
    }
    res.json({ fields, recordId: rows[0].id });
  } catch (e) {
    console.error('GET /api/checklist', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/checklist/:week/:recordId', requireAuth, async (req, res) => {
  try {
    const week = parseInt(req.params.week);
    const tableName = CHECKLIST_TABLES[week];
    if (!tableName) return res.status(400).json({ error: 'Invalid week' });

    const { field, value } = req.body;
    const allowed = CHECKLIST_FIELDS[week] || [];
    if (!allowed.includes(field)) return res.status(400).json({ error: 'Invalid field' });

    const [updated] = await base(tableName).update([{
      id: req.params.recordId,
      fields: { [field]: !!value },
    }]);

    const fields = {};
    for (const f of allowed) {
      fields[f] = !!updated.fields[f];
    }
    res.json({ fields, recordId: updated.id });
  } catch (e) {
    console.error('PATCH /api/checklist', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Public Intake Form ────────────────────────────────────────────────────────

app.post('/api/intake', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name || !b.email) return res.status(400).json({ error: 'Name and email required' });

    const [rec] = await base(CLIENTS_TABLE).create([{
      fields: {
        'Client Name': b.name,
        'Business Name': b.businessName || '',
        'Email': b.email,
        'Phone': b.phone || '',
        'Instagram': b.instagram || '',
        'Other Socials': b.otherSocials || '',
        'Website': b.website || '',
        'Brand Direction': b.brandDirection || '',
        'Services & Pricing': b.servicesAndPricing || '',
        'Target Audience': b.targetAudience || '',
        'Goals': b.goals || '',
        'Logo URL': b.logoUrl || '',
        'Filming Availability': b.filmingAvailability || '',
        'Existing Content': b.existingContent || '',
        'Heard About Us': b.heardAboutUs || '',
        'Anything Else': b.anythingElse || '',
        'Status': 'Intake Received',
        'Intake Submitted': new Date().toISOString().split('T')[0],
        'Current Week': 1,
      },
    }]);
    res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error('POST /api/intake', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Static ────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/intake', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'intake.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Gathr Client Dashboard → http://localhost:${PORT}`));
