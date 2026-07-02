require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Airtable = require('airtable');
const path = require('path');
const fs = require('fs');

// ── Local persistent store ────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, 'data', 'store.json');
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return {}; }
}
function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

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

const CHECKLIST_TABLES = {
  1: 'P1 W1',  2: 'P1 W2',  3: 'P1 W3',  4: 'P1 W4',
  5: 'P2 W5',  6: 'P2 W6',  7: 'P2 W7',  8: 'P2 W8',
  9: 'P3 W9',  10: 'P3 W10', 11: 'P3 W11', 12: 'P3 W12',
  13: 'P4 W13', 14: 'P4 W14', 15: 'P4 W15', 16: 'P4 W16',
};
const CHECKLIST_FIELDS = {
  1: ['IF', 'BDC', 'CFS', 'WIGM', 'BPCL'],
  2: ['CRM&F', 'Auto', 'Cal', 'Dom', 'BPN#', 'Offer', 'FOS'],
  3: ['RSB', 'ACF', 'FCL'],
  4: ['1:1 CRMT', 'SOP&P', 'SMM (W4-8)', 'Launch'],
  // Weeks 5–16: field names will be added once Airtable tables are built
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
    techAssignee: f['Assigned Tech Lead'] || f['Assigned Tech'] || '',
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
    addOns: f['Add ons'] || f['Add-ons'] || '',
    intakeSubmitted: f['Intake Submitted'] || '',
    createdAt: rec._rawJson?.createdTime || '',
  };
}

const FIELD_MAP = {
  name: 'Client Name',
  businessName: 'Business Name',
  business: 'Business',
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
  techAssignee: 'Assigned Tech Lead',
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
  addOns: 'Add ons',
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
  const fields = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (FIELD_MAP[key] && val !== undefined) {
      fields[FIELD_MAP[key]] = val;
    }
  }

  // Try full update first; if Airtable rejects unknown fields, retry
  // field-by-field and skip the ones that don't exist in this base
  const tryUpdate = async (f) => {
    const [updated] = await base(CLIENTS_TABLE).update([{ id: req.params.id, fields: f }]);
    return updated;
  };

  try {
    const updated = await tryUpdate(fields);
    return res.json(shapeClient(updated));
  } catch (firstErr) {
    console.warn('PUT bulk failed, retrying field-by-field:', firstErr.message);
    // Field-by-field fallback — skip any field that errors
    const safe = {};
    for (const [k, v] of Object.entries(fields)) {
      try {
        await base(CLIENTS_TABLE).update([{ id: req.params.id, fields: { [k]: v } }]);
        safe[k] = v;
      } catch (e) {
        console.warn(`Skipping field "${k}":`, e.message);
      }
    }
    try {
      // Fetch the latest record after individual updates
      const rec = await base(CLIENTS_TABLE).find(req.params.id);
      return res.json(shapeClient(rec));
    } catch (e) {
      console.error('PUT /api/clients final fetch failed', e.message);
      return res.status(500).json({ error: firstErr.message });
    }
  }
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    await base(CLIENTS_TABLE).destroy([req.params.id]);
    // Remove from local store too
    const store = readStore();
    delete store[req.params.id];
    writeStore(store);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/clients', e.message);
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
    res.json(records.map(r => ({ id: r.id, fields: r.fields })));
  } catch (e) {
    console.error('GET /api/gathr-members', e.message);
    res.json([]);
  }
});

// ── Import from Gathr Space base → main base ──────────────────────────────────

app.post('/api/import-gathr-space', requireAuth, async (req, res) => {
  try {
    // Read all records from both bases in parallel
    const [spaceRecords, mainRecords] = await Promise.all([
      spaceBase(GATHR_SPACE_TABLE).select({ view: GATHR_SPACE_VIEW }).all(),
      base(CLIENTS_TABLE).select().all(),
    ]);

    const normalize = s => (s || '').toLowerCase().trim();

    // Build lookup index of main-base clients by email and name
    const byEmail = {};
    const byName  = {};
    mainRecords.forEach(r => {
      const email = normalize(r.fields['Email']);
      const name  = normalize(r.fields['Client Name']);
      if (email) byEmail[email] = r;
      if (name)  byName[name]   = r;
    });

    // Fields we know how to write into the main base (reverse of FIELD_MAP)
    const WRITABLE = {
      'Email':              'Email',
      'Phone':              'Phone',
      'Instagram':          'Instagram',
      'Website':            'Website',
      'Business Name':      'Business Name',
      'Brand Direction':    'Brand Direction',
      'Services & Pricing': 'Services & Pricing',
      'Target Audience':    'Target Audience',
      'Goals':              'Goals',
      'Filming Availability':'Filming Availability',
      'Existing Content':   'Existing Content',
      // Common alternate field names from Gathr Space base
      'Business':           'Business Name',
      'Mobile':             'Phone',
      'IG':                 'Instagram',
      'IG Handle':          'Instagram',
      'Social':             'Instagram',
      'Site':               'Website',
      'Web':                'Website',
      'About':              'Brand Direction',
      'Bio':                'Brand Direction',
      'Services':           'Services & Pricing',
      'Pricing':            'Services & Pricing',
      'Audience':           'Target Audience',
      'Goal':               'Goals',
    };

    const results = { matched: 0, updated: 0, skipped: 0, unmatched: [] };

    for (const sr of spaceRecords) {
      const sf = sr.fields;
      const sEmail = normalize(sf['Email'] || sf['email'] || '');
      const sName  = normalize(sf['Name'] || sf['Full Name'] || sf['Client Name'] || '');

      // Find matching main-base record
      const mainRec = (sEmail && byEmail[sEmail]) || (sName && byName[sName]) || null;

      if (!mainRec) {
        if (sName) results.unmatched.push(sf['Name'] || sf['Full Name'] || sf['Client Name']);
        continue;
      }

      results.matched++;

      // Build patch: copy non-empty fields from space record that are empty in main
      const patch = {};
      for (const [spaceField, mainField] of Object.entries(WRITABLE)) {
        const val = sf[spaceField];
        if (val === undefined || val === null || String(val).trim() === '') continue;
        // Only fill if main record field is currently empty
        if (!mainRec.fields[mainField]) {
          patch[mainField] = String(val).trim();
        }
      }

      if (!Object.keys(patch).length) { results.skipped++; continue; }

      await base(CLIENTS_TABLE).update([{ id: mainRec.id, fields: patch }]);
      results.updated++;
    }

    res.json({
      ok: true,
      message: `Matched ${results.matched} clients. Updated ${results.updated}, skipped ${results.skipped} (already had data). Unmatched: ${results.unmatched.length}.`,
      ...results,
    });
  } catch (e) {
    console.error('POST /api/import-gathr-space', e.message);
    res.status(500).json({ error: e.message });
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
        'Status': 'New Client',
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

// ── Old Program Migration ─────────────────────────────────────────────────────
const OLD_FIELD_MAP = {
  'Intake Call Completed':          'ICC',
  'Brand Assets Received':          'BAR',
  'Social Links Received':          'SLR',
  'Domain Access Received':         'DAR',
  'Content Questionnaire Received': 'CQR',
  'Funnel Built':                   'FB',
  'Funnel Approved':                'FA',
  'Domain Connected':               'DC',
  'Business Number Purchased':      'BNP',
  'Sending Domain Connected':       'SDC',
  'Calendar Connected':             'CC',
  'Pipelines Created':              'PC',
  'Automations Created':            'AC',
  'Email Templates Loaded':         'ETL',
  'Booking Calendar Created':       'BCC',
  'Integrations Connected':         'ICN',
  'Bio Optimized':                  'BO',
  'CTA Finalized':                  'CTAF',
  'Pinned Posts Planned':           'PPP',
  'Content Strategy Completed':     'CSC',
  'Filming Session Scheduled':      'FSS',
  'First Content Batch Delivered':  'FCBD',
  'Revision Call Completed':        'RCC',
  'Client Training Completed':      'CTC',
  'Playbook Sent':                  'PS',
  'Weekly Tech Call Assigned':      'WTCA',
  'Client Added To Support Group':  'CASG',
  'Internal QA Completed':          'IQAC',
  'Ready For Launch':               'RFL',
  'Launch Completed':               'LC',
};

app.post('/api/migrate-old-program', requireAuth, async (req, res) => {
  let { oldBaseId } = req.body;
  if (!oldBaseId) return res.status(400).json({ error: 'oldBaseId required' });
  // Extract just the base ID if user pasted a full URL or path
  const baseMatch = oldBaseId.match(/app[A-Za-z0-9]+/);
  if (!baseMatch) return res.status(400).json({ error: 'Could not find a valid base ID (should start with "app")' });
  oldBaseId = baseMatch[0];

  const oldBase = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(oldBaseId);
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, ' ');

  try {
    const [oldRecords, mainRecords] = await Promise.all([
      oldBase('Onboarding & Build').select().all(),
      base(CLIENTS_TABLE).select().all(),
    ]);

    // Build name index from main base
    const byName = {};
    mainRecords.forEach(r => {
      byName[norm(r.fields['Client Name'])] = r;
    });

    const store = readStore();
    const results = { updated: [], notFound: [], errors: [] };

    for (const oldRec of oldRecords) {
      const oldName = oldRec.fields['Clients Name'] || oldRec.fields['Client Name'] || '';
      if (!oldName) continue;

      const mainRec = byName[norm(oldName)];
      if (!mainRec) { results.notFound.push(oldName); continue; }

      // Update Package to "Old Program" in main Airtable
      try {
        await base(CLIENTS_TABLE).update([{ id: mainRec.id, fields: { 'Package': 'Old Program' } }]);
      } catch (e) {
        results.errors.push(`${oldName}: ${e.message}`);
      }

      // Build checklist state from old base checkboxes
      const checklist = {};
      for (const [fieldName, key] of Object.entries(OLD_FIELD_MAP)) {
        checklist[key] = !!oldRec.fields[fieldName];
      }

      store[mainRec.id] = store[mainRec.id] || {};
      store[mainRec.id].oldProgramChecklist = checklist;
      results.updated.push(oldName);
    }

    writeStore(store);
    res.json({ ok: true, updated: results.updated, notFound: results.notFound, errors: results.errors });
  } catch (e) {
    console.error('migrate-old-program', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Local Store Routes ────────────────────────────────────────────────────────

app.get('/api/local/:clientId', requireAuth, (req, res) => {
  const store = readStore();
  res.json(store[req.params.clientId] || {});
});

app.put('/api/local/:clientId', requireAuth, (req, res) => {
  const store = readStore();
  store[req.params.clientId] = { ...(store[req.params.clientId] || {}), ...req.body };
  writeStore(store);
  res.json(store[req.params.clientId]);
});

app.get('/api/local', requireAuth, (req, res) => {
  res.json(readStore());
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
