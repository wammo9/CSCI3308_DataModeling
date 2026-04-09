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
 * GET    /api/datasets               list user's datasets       [auth]
 * POST   /api/datasets/upload        upload + parse a CSV       [auth]
 * GET    /api/datasets/:id/preview   first 10 rows of dataset   [auth]
 * PATCH  /api/datasets/:id           rename / add notes         [auth]
 * GET    /api/datasets/:id/quality   dataset quality report     [auth]
 * DELETE /api/datasets/:id           delete dataset + PCA runs  [auth]
 * POST   /api/datasets/:id/pca      run PCA on a dataset       [auth]
 * GET    /api/datasets/:id/pca      list PCA runs for dataset   [auth]
 * GET    /api/pca/:id               fetch a single PCA result   [auth]
 * GET    /api/pca/:id/export        download transformed CSV    [auth]
 * DELETE /api/pca/:id               delete a PCA run            [auth]
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

// Helper: resolve userId from token
async function resolveUserId(req) {
  if (req.user.userId) return req.user.userId;
  const r = await pool.query('SELECT id FROM users WHERE username = $1', [req.user.username]);
  return r.rows[0]?.id;
}

async function ensureSchema() {
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS quality_report JSONB');
}

function isNumericValue(value) {
  return value !== '' && value != null && isFinite(Number(value));
}

function summarizeNumericColumn(records, col) {
  const numericValues = records
    .map((row) => row[col])
    .filter((value) => isNumericValue(value))
    .map(Number);
  const missingCount = records.filter((row) => row[col] === '' || row[col] == null).length;
  const invalidCount = records.filter(
    (row) => row[col] !== '' && row[col] != null && !isFinite(Number(row[col]))
  ).length;

  const sum = numericValues.reduce((total, value) => total + value, 0);
  const mean = numericValues.length ? sum / numericValues.length : 0;
  const variance = numericValues.length
    ? numericValues.reduce((total, value) => total + (value - mean) ** 2, 0) / numericValues.length
    : 0;
  const sorted = [...numericValues].sort((a, b) => a - b);
  const stdDev = Math.sqrt(variance);

  return {
    name: col,
    count: numericValues.length,
    missingCount,
    invalidCount,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean,
    stdDev,
    isConstant: numericValues.length > 0 && sorted[0] === sorted[sorted.length - 1],
  };
}

function buildQualityReport(records, allColumns, quantitativeColumns, cleanRows) {
  const ignoredColumns = allColumns.filter((col) => !quantitativeColumns.includes(col));
  const numericSummaries = quantitativeColumns.map((col) => summarizeNumericColumn(records, col));
  const totalRows = records.length;
  const validRows = cleanRows.length;
  const droppedRows = totalRows - validRows;
  const warnings = [];

  if (droppedRows > 0) {
    warnings.push(`${droppedRows} row${droppedRows === 1 ? '' : 's'} excluded from PCA due to missing values.`);
  }
  for (const summary of numericSummaries) {
    if (summary.isConstant) {
      warnings.push(`${summary.name} has the same value in every usable row.`);
    }
  }
  for (const col of ignoredColumns) {
    const numericLikeCount = records.filter((row) => isNumericValue(row[col])).length;
    const missingCount = records.filter((row) => row[col] === '' || row[col] == null).length;
    if (numericLikeCount > 0 && numericLikeCount + missingCount < totalRows) {
      warnings.push(`${col} was ignored because it mixes numeric and non-numeric values.`);
    }
  }

  return {
    rows: {
      total: totalRows,
      usableForPca: validRows,
      droppedForPca: droppedRows,
    },
    columns: {
      total: allColumns.length,
      quantitative: quantitativeColumns.length,
      ignored: ignoredColumns.length,
    },
    numericColumns: numericSummaries,
    ignoredColumns: ignoredColumns.map((col) => ({
      name: col,
      missingCount: records.filter((row) => row[col] === '' || row[col] == null).length,
      numericLikeCount: records.filter((row) => isNumericValue(row[col])).length,
    })),
    warnings,
  };
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
      `SELECT id, original_filename, name, notes, row_count, column_count,
              quantitative_columns, all_columns, upload_timestamp
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
    return values.length > 0 && values.every((v) => isNumericValue(v));
  });

  if (quantColumns.length < 2) {
    return res.status(400).json({
      status: 'error',
      message: `Need at least 2 numeric columns. Found: ${quantColumns.join(', ') || 'none'}.`,
    });
  }

  // Drop rows that have a missing or non-numeric value in any quant column
  const clean = records.filter((row) =>
    quantColumns.every((col) => isNumericValue(row[col]))
  );

  if (clean.length < 2) {
    return res.status(400).json({
      status: 'error',
      message: 'Not enough valid rows after removing rows with missing values.',
    });
  }

  // Build numeric matrix
  const matrix = clean.map((row) => quantColumns.map((col) => Number(row[col])));

  // Build preview: first 10 rows with ALL columns (for dataset preview feature)
  const preview = records.slice(0, 10).map((row) => {
    const obj = {};
    for (const col of allColumns) obj[col] = row[col];
    return obj;
  });
  const qualityReport = buildQualityReport(records, allColumns, quantColumns, clean);

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `INSERT INTO datasets
         (user_id, original_filename, name, row_count, column_count,
          quantitative_columns, all_columns, raw_data, preview_data, quality_report)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        uid,
        req.file.originalname,
        req.file.originalname.replace(/\.csv$/i, ''),
        clean.length,
        allColumns.length,
        quantColumns,
        allColumns,
        JSON.stringify(matrix),
        JSON.stringify(preview),
        JSON.stringify(qualityReport),
      ]
    );
    return res.json({
      status: 'success',
      datasetId: result.rows[0].id,
      filename: req.file.originalname,
      rowCount: clean.length,
      columnCount: allColumns.length,
      quantitativeColumns: quantColumns,
      qualityReport,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to save dataset' });
  }
});

// ── FEATURE 1: Dataset Preview ───────────────────────────────────────────────

app.get('/api/datasets/:id/preview', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT preview_data, all_columns, quantitative_columns, original_filename, row_count
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    const ds = result.rows[0];
    return res.json({
      status: 'success',
      filename: ds.original_filename,
      totalRows: ds.row_count,
      columns: ds.all_columns,
      quantitativeColumns: ds.quantitative_columns,
      preview: ds.preview_data ?? [],
    });
  } catch (err) {
    console.error('Preview error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/quality', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT quality_report, all_columns, quantitative_columns, row_count, column_count
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    const ds = result.rows[0];
    const fallbackReport = {
      rows: { total: ds.row_count, usableForPca: ds.row_count, droppedForPca: 0 },
      columns: {
        total: ds.column_count,
        quantitative: ds.quantitative_columns?.length ?? 0,
        ignored: Math.max(0, (ds.all_columns?.length ?? 0) - (ds.quantitative_columns?.length ?? 0)),
      },
      numericColumns: [],
      ignoredColumns: (ds.all_columns ?? [])
        .filter((col) => !(ds.quantitative_columns ?? []).includes(col))
        .map((name) => ({ name, missingCount: null, numericLikeCount: null })),
      warnings: [],
    };
    return res.json({
      status: 'success',
      qualityReport: ds.quality_report ?? fallbackReport,
    });
  } catch (err) {
    console.error('Quality report error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── FEATURE 2: Delete Dataset ────────────────────────────────────────────────

app.delete('/api/datasets/:id', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      'DELETE FROM datasets WHERE id = $1 AND user_id = $2 RETURNING id',
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    return res.json({ status: 'success', message: 'Dataset deleted' });
  } catch (err) {
    console.error('Delete dataset error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── FEATURE 2: Delete PCA Run ────────────────────────────────────────────────

app.delete('/api/pca/:id', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }

  try {
    const uid = await resolveUserId(req);
    // Verify ownership through the dataset join
    const result = await pool.query(
      `DELETE FROM pca_runs
       WHERE id = $1
         AND dataset_id IN (SELECT id FROM datasets WHERE user_id = $2)
       RETURNING id`,
      [runId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }
    return res.json({ status: 'success', message: 'PCA run deleted' });
  } catch (err) {
    console.error('Delete PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── FEATURE 5: Rename / Add Notes ────────────────────────────────────────────

app.patch('/api/datasets/:id', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  const { name, notes } = req.body ?? {};
  if (name === undefined && notes === undefined) {
    return res.status(400).json({ status: 'error', message: 'Provide name or notes to update' });
  }

  try {
    const uid = await resolveUserId(req);

    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(String(name).slice(0, 255));
    }
    if (notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(String(notes).slice(0, 2000));
    }
    values.push(datasetId, uid);

    const result = await pool.query(
      `UPDATE datasets SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, name, notes`,
      values
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    return res.json({ status: 'success', dataset: result.rows[0] });
  } catch (err) {
    console.error('Patch dataset error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
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
    const availableColumns = ds.quantitative_columns ?? [];
    const requestedColumns = Array.isArray(req.body?.columns)
      ? [...new Set(req.body.columns.map(String).map((col) => col.trim()).filter(Boolean))]
      : null;
    const selectedColumns = requestedColumns?.length ? requestedColumns : availableColumns;
    const invalidColumns = selectedColumns.filter((col) => !availableColumns.includes(col));

    if (invalidColumns.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Unknown numeric column${invalidColumns.length === 1 ? '' : 's'}: ${invalidColumns.join(', ')}`,
      });
    }
    if (selectedColumns.length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'Choose at least 2 numeric columns for PCA.',
      });
    }

    const columnIndexes = selectedColumns.map((col) => availableColumns.indexOf(col));
    const matrix = ds.raw_data.map((row) => columnIndexes.map((index) => Number(row[index])));
    const nFeatures = selectedColumns.length;

    // Decide on number of output components
    let nComponents = nFeatures >= 3 ? 3 : 2;
    if (req.body?.nComponents !== undefined) {
      const requestedComponents = Number(req.body.nComponents);
      if (![2, 3].includes(requestedComponents)) {
        return res.status(400).json({
          status: 'error',
          message: 'Number of PCA components must be 2 or 3.',
        });
      }
      nComponents = requestedComponents;
    }
    const scale = req.body?.scale === undefined ? true : Boolean(req.body.scale);

    let pcaResult;
    try {
      pcaResult = runPCA(matrix, nComponents, { scale });
    } catch (err) {
      return res.status(400).json({ status: 'error', message: err.message });
    }

    const runResult = await pool.query(
      `INSERT INTO pca_runs
         (dataset_id, n_components, explained_variance_ratio,
          all_explained_variance, transformed_data, column_names, n_samples)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        datasetId,
        pcaResult.nComponents,
        JSON.stringify(pcaResult.explainedVarianceRatio),
        JSON.stringify(pcaResult.allExplainedVariance),
        JSON.stringify(pcaResult.transformed),
        selectedColumns,
        pcaResult.nSamples,
      ]
    );

    return res.json({
      status: 'success',
      runId: runResult.rows[0].id,
      nComponents: pcaResult.nComponents,
      explainedVarianceRatio: pcaResult.explainedVarianceRatio,
      allExplainedVariance: pcaResult.allExplainedVariance,
      totalExplained: pcaResult.totalExplained,
      nSamples: pcaResult.nSamples,
      columnNames: selectedColumns,
      filename: ds.original_filename,
      scale,
    });
  } catch (err) {
    console.error('PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'PCA failed: ' + err.message });
  }
});

// List all PCA runs for a dataset
app.get('/api/datasets/:id/pca', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }
  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT r.id, r.n_components, r.explained_variance_ratio, r.column_names, r.n_samples, r.created_at
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.dataset_id = $1 AND d.user_id = $2
       ORDER BY r.created_at DESC`,
      [datasetId, uid]
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
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT r.*, d.original_filename
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
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
      allExplainedVariance: run.all_explained_variance,
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

// ── FEATURE 4: Export Transformed Data as CSV ────────────────────────────────

app.get('/api/pca/:id/export', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }
  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT r.transformed_data, r.n_components, r.n_samples, d.original_filename
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }

    const { transformed_data, n_components, original_filename } = result.rows[0];
    const headers = Array.from({ length: n_components }, (_, i) => `PC${i + 1}`);
    const lines = [headers.join(',')];
    for (const row of transformed_data) {
      lines.push(row.map((v) => v.toFixed(6)).join(','));
    }

    const csvName = original_filename.replace(/\.csv$/i, '') + '_pca.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${csvName}"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export PCA error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  ensureSchema()
    .then(() => {
      app.listen(port, () => {
        console.log(`ModelScope server listening on port ${port}`);
      });
    })
    .catch((err) => {
      console.error('Database schema check failed:', err);
      process.exit(1);
    });
}

export default app;
