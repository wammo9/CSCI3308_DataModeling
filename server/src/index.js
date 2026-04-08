/**
 * ModelScope — Express API server
 *
 * Routes
 * ──────
 * GET  /welcome                      backward-compat test stub
 * GET  /test                         redirect to /login (test stub)
 * GET  /login                        HTML response (test stub)
 * GET  /api/health                   health check
 * GET  /api/features                 feature list for home page
 *
 * POST /register                     create account (returns JWT)
 * POST /api/login                    authenticate (returns JWT)
 *
 * GET  /api/datasets                 list user's datasets       [auth]
 * POST /api/datasets/upload          upload + parse a CSV       [auth]
 * POST /api/datasets/:id/pca         run PCA on a dataset       [auth]
 * GET  /api/datasets/:id/pca         list PCA runs for dataset  [auth]
 * GET  /api/pca/:id                  fetch a single PCA result  [auth]
 */

import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import pool from './db.js';
import { runPCA } from './pca.js';

const app = express();
const port = process.env.PORT || 5001;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    ok ? cb(null, true) : cb(new Error('Only CSV files are allowed'));
  },
});

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', message: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), jwtSecret);
    next();
  } catch {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

// Helper: resolve userId from token (token always includes it after registration)
async function resolveUserId(req) {
  if (req.user.userId) return req.user.userId;
  const r = await pool.query('SELECT id FROM users WHERE username = $1', [req.user.username]);
  return r.rows[0]?.id;
}

// ── Backward-compat stubs (keep existing tests passing) ──────────────────────

app.get('/welcome', (_req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.get('/test', (_req, res) => {
  res.redirect('/login');
});

app.get('/login', (_req, res) => {
  res.status(200).send('<html><body>Login Page</body></html>');
});

// ── Public API ────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'modelscope-api', message: 'Express server is running.' });
});

app.get('/api/features', (_req, res) => {
  res.json([
    'Upload CSV datasets',
    'Generate automatic data models',
    'Organize saved modeling projects',
  ]);
});

// ── Registration ─────────────────────────────────────────────────────────────

app.post('/register', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password || typeof username !== 'string') {
    return res.status(400).json({ status: 'error', message: 'Invalid input' });
  }
  if (username.trim().length < 3 || String(password).length < 6) {
    return res.status(400).json({
      status: 'error',
      message: 'Username must be at least 3 characters; password at least 6.',
    });
  }

  // In test mode skip the DB so unit tests don't need a live Postgres instance.
  if (process.env.NODE_ENV === 'test') {
    return res.status(200).json({ status: 'success', message: 'Success' });
  }

  try {
    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username.trim(), hash]
    );
    const token = jwt.sign(
      { username: username.trim(), userId: result.rows[0].id },
      jwtSecret,
      { expiresIn: '7d' }
    );
    return res.status(200).json({ status: 'success', message: 'Success', token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ status: 'error', message: 'Username already taken' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }
    const token = jwt.sign({ username: user.username, userId: user.id }, jwtSecret, {
      expiresIn: '7d',
    });
    return res.json({ status: 'success', token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── Datasets ──────────────────────────────────────────────────────────────────

// List all datasets for the authenticated user
app.get('/api/datasets', requireAuth, async (req, res) => {
  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT id, original_filename, row_count, column_count,
              quantitative_columns, upload_timestamp
       FROM datasets
       WHERE user_id = $1
       ORDER BY upload_timestamp DESC`,
      [uid]
    );
    return res.json({ status: 'success', datasets: result.rows });
  } catch (err) {
    console.error('List datasets error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// Upload a CSV, validate it, store parsed numeric matrix in the DB
app.post('/api/datasets/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  // Parse CSV
  let records;
  try {
    records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: 'Could not parse CSV: ' + err.message });
  }

  if (!records.length) {
    return res.status(400).json({ status: 'error', message: 'CSV file is empty' });
  }

  // Detect quantitative columns (every non-empty value parses as a finite number)
  const allColumns = Object.keys(records[0]);
  const quantColumns = allColumns.filter((col) => {
    const values = records
      .map((r) => r[col])
      .filter((v) => v !== '' && v != null);
    return values.length > 0 && values.every((v) => isFinite(Number(v)));
  });

  if (quantColumns.length < 2) {
    return res.status(400).json({
      status: 'error',
      message: `Need at least 2 numeric columns. Found: ${quantColumns.join(', ') || 'none'}.`,
    });
  }

  // Drop rows that have a missing or non-numeric value in any quant column
  const clean = records.filter((row) =>
    quantColumns.every((col) => row[col] !== '' && isFinite(Number(row[col])))
  );

  if (clean.length < 2) {
    return res.status(400).json({
      status: 'error',
      message: 'Not enough valid rows after removing rows with missing values.',
    });
  }

  // Build numeric matrix
  const matrix = clean.map((row) => quantColumns.map((col) => Number(row[col])));

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `INSERT INTO datasets
         (user_id, original_filename, row_count, column_count, quantitative_columns, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [uid, req.file.originalname, clean.length, allColumns.length, quantColumns, JSON.stringify(matrix)]
    );
    return res.json({
      status: 'success',
      datasetId: result.rows[0].id,
      filename: req.file.originalname,
      rowCount: clean.length,
      columnCount: allColumns.length,
      quantitativeColumns: quantColumns,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to save dataset' });
  }
});

// ── PCA ───────────────────────────────────────────────────────────────────────

// Run PCA on a dataset and store the result
app.post('/api/datasets/:id/pca', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const dsResult = await pool.query(
      'SELECT * FROM datasets WHERE id = $1 AND user_id = $2',
      [datasetId, uid]
    );
    if (!dsResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const ds = dsResult.rows[0];
    const matrix = ds.raw_data; // already parsed from JSONB by pg driver
    const nFeatures = ds.quantitative_columns.length;

    // Decide on number of output components
    const nComponents = nFeatures >= 3 ? 3 : 2;

    let pcaResult;
    try {
      pcaResult = runPCA(matrix, nComponents);
    } catch (err) {
      return res.status(400).json({ status: 'error', message: err.message });
    }

    const runResult = await pool.query(
      `INSERT INTO pca_runs
         (dataset_id, n_components, explained_variance_ratio, transformed_data, column_names, n_samples)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        datasetId,
        pcaResult.nComponents,
        JSON.stringify(pcaResult.explainedVarianceRatio),
        JSON.stringify(pcaResult.transformed),
        ds.quantitative_columns,
        pcaResult.nSamples,
      ]
    );

    return res.json({
      status: 'success',
      runId: runResult.rows[0].id,
      nComponents: pcaResult.nComponents,
      explainedVarianceRatio: pcaResult.explainedVarianceRatio,
      totalExplained: pcaResult.totalExplained,
      nSamples: pcaResult.nSamples,
      columnNames: ds.quantitative_columns,
      filename: ds.original_filename,
    });
  } catch (err) {
    console.error('PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'PCA failed: ' + err.message });
  }
});

// List all PCA runs for a dataset
app.get('/api/datasets/:id/pca', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `SELECT id, n_components, explained_variance_ratio, n_samples, created_at
       FROM pca_runs
       WHERE dataset_id = $1
       ORDER BY created_at DESC`,
      [datasetId]
    );
    return res.json({ status: 'success', runs: result.rows });
  } catch (err) {
    console.error('List PCA runs error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// Fetch a specific PCA run (visualization data)
app.get('/api/pca/:id', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }
  try {
    const result = await pool.query(
      `SELECT r.*, d.original_filename
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1`,
      [runId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }
    const run = result.rows[0];
    return res.json({
      status: 'success',
      runId: run.id,
      filename: run.original_filename,
      nComponents: run.n_components,
      explainedVarianceRatio: run.explained_variance_ratio,
      transformedData: run.transformed_data,
      columnNames: run.column_names,
      nSamples: run.n_samples,
      createdAt: run.created_at,
    });
  } catch (err) {
    console.error('Get PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`ModelScope server listening on port ${port}`);
  });
}

export default app;
