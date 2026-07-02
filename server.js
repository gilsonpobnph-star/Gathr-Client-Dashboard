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
  cookie: { maxAge: 10 * 60 * 60 * 1000 }, // 10 hours
}));

const PASS = process.env.DASHBOARD_PASSWORD || 'gathr2025';
const TEAM_MEMBERS = (process.env.TEAM_MEMBERS || 'Gil,Glaiza').split(',').map(s => s.trim());

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const CLIENTS_TABLE = process.env.AIRTABLE_CLIENTS_TABLE || 'Clients';

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

function parseChecklist(val) {
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}

function shapeClient(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    name: f['Name'] || '',
    businessName: f['Business Name'] || '',
    email: f['Email'] || '',
    phone: f['Phone'] || '',
    instagram: f['Instagram'] || '',
    otherSocials: f['Other Socials'] || '',
    website: f['Website'] || '',
    program: f['Program'] || '',
    status: f['Status'] || 'Intake Received',
    currentWeek: f['Current Week'] || 1,
    startDate: f['Start Date'] || '',
    leadAssignee: f['Lead Assignee'] || '',
    techAssignee: f['Tech Assignee'] || '',
    brandDirection: f['Brand Direction'] || '',
    servicesAndPricing: f['Services & Pricing'] || '',
    targetAudience: f['Target Audience'] || '',
    goals: f['Goals'] || '',
    logoUrl: f['Logo URL'] || '',
    currentFollowers: f['Current Followers'] || '',
    filmingAvailability: f['Filming Availability'] || '',
    existingContent: f['Existing Content'] || '',
    businessPhone: f['Business Phone'] || '',
    heardAboutUs: f['Heard About Us'] || '',
    anythingElse: f['Anything Else'] || '',
    notes: f['Notes'] || '',
    checklistState: parseChecklist(f['Checklist State']),
    intakeSubmitted: f['Intake Submitted'] || '',
    createdAt: rec._rawJson?.createdTime || '',
  };
}

const FIELD_MAP = {
  name: 'Name',
  businessName: 'Business Name',
  email: 'Email',
  phone: 'Phone',
  instagram: 'Instagram',
  otherSocials: 'Other Socials',
  website: 'Website',
  program: 'Program',
  status: 'Status',
  currentWeek: 'Current Week',
  startDate: 'Start Date',
  leadAssignee: 'Lead Assignee',
  techAssignee: 'Tech Assignee',
  brandDirection: 'Brand Direction',
  servicesAndPricing: 'Services & Pricing',
  targetAudience: 'Target Audience',
  goals: 'Goals',
  logoUrl: 'Logo URL',
  currentFollowers: 'Current Followers',
  filmingAvailability: 'Filming Availability',
  existingContent: 'Existing Content',
  businessPhone: 'Business Phone',
  heardAboutUs: 'Heard About Us',
  anythingElse: 'Anything Else',
  notes: 'Notes',
  checklistState: 'Checklist State',
};

// ── Client Routes ─────────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const records = await base(CLIENTS_TABLE).select({
      sort: [{ field: 'Name', direction: 'asc' }],
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
      if (!FIELD_MAP[key]) continue;
      if (key === 'checklistState') {
        fields[FIELD_MAP[key]] = JSON.stringify(val);
      } else {
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

app.get('/api/team', requireAuth, (req, res) => {
  res.json(TEAM_MEMBERS);
});

// ── Public Intake Form ────────────────────────────────────────────────────────

app.post('/api/intake', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name || !b.email) return res.status(400).json({ error: 'Name and email required' });

    const [rec] = await base(CLIENTS_TABLE).create([{
      fields: {
        'Name': b.name,
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
        'Current Followers': b.currentFollowers ? Number(b.currentFollowers) : undefined,
        'Filming Availability': b.filmingAvailability || '',
        'Existing Content': b.existingContent || '',
        'Business Phone': b.businessPhone || '',
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

// ── Static / SPA ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/intake', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'intake.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Gathr Client Dashboard → http://localhost:${PORT}`));
