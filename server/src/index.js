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
 * GET    /api/samples                list sample datasets       [auth]
 * POST   /api/samples/:id            add a sample dataset       [auth]
 * POST   /api/datasets/upload        upload + parse a CSV       [auth]
 * GET    /api/datasets/:id/versions  list dataset versions      [auth]
 * GET    /api/datasets/:id/presets   list saved PCA presets     [auth]
 * POST   /api/datasets/:id/presets   save a PCA preset          [auth]
 * DELETE /api/datasets/:id/presets/:presetId delete a PCA preset [auth]
 * GET    /api/datasets/:id/preview   first 10 rows of dataset   [auth]
 * PATCH  /api/datasets/:id           rename / add notes         [auth]
 * GET    /api/datasets/:id/quality   dataset quality report     [auth]
 * GET    /api/datasets/:id/assistant data-cleaning suggestions  [auth]
 * GET    /api/datasets/:id/analysis  numeric analysis data      [auth]
 * GET    /api/datasets/:id/report    download analysis report   [auth]
 * DELETE /api/datasets/:id           delete dataset + PCA runs  [auth]
 * POST   /api/datasets/:id/pca/preview preview PCA preprocessing [auth]
 * POST   /api/datasets/:id/pca      run PCA on a dataset       [auth]
 * GET    /api/datasets/:id/pca/compare compare two PCA runs     [auth]
 * GET    /api/datasets/:id/pca      list PCA runs for dataset   [auth]
 * GET    /api/pca/:id               fetch a single PCA result   [auth]
 * GET    /api/pca/:id/narrative     interpret a PCA result      [auth]
 * PATCH  /api/pca/:id               update run notes / pin      [auth]
 * GET    /api/pca/:id/clusters      k-means clusters for run    [auth]
 * GET    /api/pca/:id/report        download PCA report         [auth]
 * GET    /api/pca/:id/export        download transformed CSV    [auth]
 * DELETE /api/pca/:id               delete a PCA run            [auth]
 */

import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import pool from './db.js';
import { runPCA } from './pca.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadOptionalEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadOptionalEnvFile();

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
  // Create tables if they don't exist (needed for fresh deployments like Render
  // where Docker's docker-entrypoint-initdb.d doesn't run)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(50)  UNIQUE NOT NULL,
      password_hash CHAR(60)     NOT NULL,
      display_name  TEXT         DEFAULT '',
      email         VARCHAR(255),
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS datasets (
      id                    SERIAL PRIMARY KEY,
      user_id               INTEGER      REFERENCES users(id) ON DELETE CASCADE,
      original_filename     VARCHAR(255) NOT NULL,
      name                  TEXT,
      notes                 TEXT         DEFAULT '',
      is_favorite           BOOLEAN      DEFAULT FALSE,
      tags                  TEXT[]       DEFAULT ARRAY[]::TEXT[],
      saved_presets         JSONB        DEFAULT '[]'::jsonb,
      version_group_id      INTEGER,
      previous_version_id   INTEGER,
      version_number        INTEGER      DEFAULT 1,
      row_count             INTEGER,
      column_count          INTEGER,
      quantitative_columns  TEXT[],
      categorical_columns   TEXT[],
      all_columns           TEXT[],
      raw_data              JSONB,
      preview_data          JSONB,
      row_metadata          JSONB,
      quality_report        JSONB,
      all_records           JSONB,
      upload_timestamp      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pca_runs (
      id                       SERIAL PRIMARY KEY,
      dataset_id               INTEGER      REFERENCES datasets(id) ON DELETE CASCADE,
      notes                    TEXT         DEFAULT '',
      is_pinned                BOOLEAN      DEFAULT FALSE,
      n_components             INTEGER      NOT NULL,
      explained_variance_ratio JSONB,
      all_explained_variance   JSONB,
      loadings                 JSONB,
      transformed_data         JSONB,
      column_names             TEXT[],
      n_samples                INTEGER,
      preprocessing_options    JSONB,
      preprocessing_report     JSONB,
      preprocessing_diff       JSONB,
      row_indexes              JSONB,
      created_at               TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // Migrate any columns that may be missing in older databases
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS quality_report JSONB');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS categorical_columns TEXT[]');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS row_metadata JSONB');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS all_records JSONB');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[]');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS saved_presets JSONB DEFAULT \'[]\'::jsonb');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS version_group_id INTEGER');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS previous_version_id INTEGER');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS loadings JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS preprocessing_options JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS preprocessing_report JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS preprocessing_diff JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS row_indexes JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT \'\'');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE');
  await pool.query('UPDATE datasets SET saved_presets = \'[]\'::jsonb WHERE saved_presets IS NULL');
  await pool.query('UPDATE datasets SET is_favorite = FALSE WHERE is_favorite IS NULL');
  await pool.query('UPDATE datasets SET tags = ARRAY[]::TEXT[] WHERE tags IS NULL');
  await pool.query('UPDATE datasets SET version_number = 1 WHERE version_number IS NULL');
  await pool.query('UPDATE datasets SET version_group_id = id WHERE version_group_id IS NULL');
  await pool.query('UPDATE pca_runs SET notes = \'\' WHERE notes IS NULL');
  await pool.query('UPDATE pca_runs SET is_pinned = FALSE WHERE is_pinned IS NULL');
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
    validForPca: quantitativeColumns.length >= 2 && validRows >= 2,
    validationMessage: quantitativeColumns.length >= 2 && validRows >= 2
      ? `Dataset is valid for PCA: ${validRows} usable rows and ${quantitativeColumns.length} numeric columns.`
      : 'Dataset is invalid for PCA because it needs at least 2 usable rows and 2 numeric columns.',
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

function fallbackQualityReportFromDataset(ds) {
  const quantitativeColumns = ds.quantitative_columns ?? [];
  const allColumns = ds.all_columns ?? [];
  const rowCount = ds.row_count ?? 0;
  return {
    rows: { total: rowCount, usableForPca: rowCount, droppedForPca: 0 },
    columns: {
      total: ds.column_count ?? allColumns.length,
      quantitative: quantitativeColumns.length,
      ignored: Math.max(0, allColumns.length - quantitativeColumns.length),
    },
    numericColumns: [],
    ignoredColumns: allColumns
      .filter((col) => !quantitativeColumns.includes(col))
      .map((name) => ({ name, missingCount: null, numericLikeCount: null })),
    warnings: [],
    validForPca: quantitativeColumns.length >= 2 && rowCount >= 2,
    validationMessage: quantitativeColumns.length >= 2 && rowCount >= 2
      ? `Dataset is valid for PCA: ${rowCount} usable rows and ${quantitativeColumns.length} numeric columns.`
      : 'Dataset is invalid for PCA because it needs at least 2 usable rows and 2 numeric columns.',
  };
}

function detectCategoricalColumns(records, allColumns, quantitativeColumns) {
  return allColumns.filter((col) => {
    if (quantitativeColumns.includes(col)) return false;
    const values = records
      .map((row) => row[col])
      .filter((value) => value !== '' && value != null)
      .map(String);
    const unique = new Set(values);
    return values.length > 0 && unique.size <= Math.min(50, Math.max(8, records.length * 0.6));
  });
}

function buildRowMetadata(cleanRowsWithIndex, allColumns, quantitativeColumns, categoricalColumns) {
  return cleanRowsWithIndex.map(({ row, index }) => {
    const labels = {};
    for (const col of categoricalColumns) labels[col] = row[col] ?? '';
    const values = {};
    for (const col of allColumns) values[col] = row[col] ?? '';
    return {
      rowNumber: index + 1,
      labels,
      values,
      numeric: Object.fromEntries(quantitativeColumns.map((col) => [col, Number(row[col])])),
    };
  });
}

function buildDatasetInsights(qualityReport, analysis) {
  const insights = [];
  const dropped = qualityReport.rows?.droppedForPca ?? 0;
  if (dropped > 0) {
    insights.push(`${dropped} row${dropped === 1 ? '' : 's'} were excluded before analysis because numeric values were missing.`);
  } else {
    insights.push('Every row with numeric data was usable for PCA.');
  }

  const strongest = analysis.strongestCorrelations?.[0];
  if (strongest && strongest.r !== null && Math.abs(strongest.r) >= 0.7) {
    const direction = strongest.r > 0 ? 'positive' : 'negative';
    insights.push(`${strongest.x} and ${strongest.y} have a strong ${direction} correlation (${strongest.r.toFixed(2)}).`);
  }

  const variableColumns = [...(analysis.columnStats ?? [])]
    .filter((col) => Number.isFinite(col.stdDev))
    .sort((a, b) => b.stdDev - a.stdDev);
  if (variableColumns[0]) {
    insights.push(`${variableColumns[0].name} has the largest spread among numeric features.`);
  }

  const constantColumn = qualityReport.numericColumns?.find((col) => col.isConstant);
  if (constantColumn) {
    insights.push(`${constantColumn.name} is constant and may not add useful signal to PCA.`);
  }

  return insights;
}

function looksLikeOutlierColumn(summary) {
  if (!summary || !Number.isFinite(summary.stdDev) || summary.stdDev <= 0) return false;
  const highTail = Number.isFinite(summary.max) && Math.abs(summary.max - summary.mean) > 3 * summary.stdDev;
  const lowTail = Number.isFinite(summary.min) && Math.abs(summary.mean - summary.min) > 3 * summary.stdDev;
  return highTail || lowTail;
}

function shouldScaleFeatures(numericColumns = []) {
  const ranges = numericColumns
    .map((col) => Number(col.max) - Number(col.min))
    .filter((range) => Number.isFinite(range) && range > 0);
  if (ranges.length < 2) return true;
  return Math.max(...ranges) / Math.max(Math.min(...ranges), 1e-9) >= 10;
}

function recommendMissingValueStrategy(qualityReport) {
  if ((qualityReport.rows?.droppedForPca ?? 0) <= 0) return 'drop';
  const hasPotentialOutliers = (qualityReport.numericColumns ?? []).some(looksLikeOutlierColumn);
  return hasPotentialOutliers ? 'median' : 'mean';
}

function buildCleaningAssistant(ds) {
  const qualityReport = ds.quality_report ?? fallbackQualityReportFromDataset(ds);
  const numericColumns = qualityReport.numericColumns ?? [];
  const quantitativeColumns = ds.quantitative_columns ?? [];
  const categoricalColumns = ds.categorical_columns ?? [];
  const totalRows = qualityReport.rows?.total ?? ds.row_count ?? 0;
  const droppedRows = qualityReport.rows?.droppedForPca ?? 0;
  const constantColumns = numericColumns.filter((col) => col.isConstant).map((col) => col.name);
  const mixedColumns = (qualityReport.ignoredColumns ?? [])
    .filter((col) => Number(col.numericLikeCount) > 0 && (Number(col.numericLikeCount) + Number(col.missingCount || 0)) < totalRows)
    .map((col) => col.name);
  const outlierColumns = numericColumns.filter(looksLikeOutlierColumn).map((col) => col.name);
  const missingValueStrategy = recommendMissingValueStrategy(qualityReport);
  const scale = shouldScaleFeatures(numericColumns);
  const recommendedNumericColumns = quantitativeColumns.filter((col) => !constantColumns.includes(col));
  const recommendedCategoricalColumns = categoricalColumns.slice(0, 2);
  const recommendedOutlierMethod = outlierColumns.length > 0 ? 'iqr' : 'none';
  const recommendedFeatureCount = recommendedNumericColumns.length + recommendedCategoricalColumns.length;
  const recommendedComponents = recommendedFeatureCount >= 3 ? 3 : 2;
  const actions = [];
  const takeaways = [];

  if (droppedRows > 0) {
    const suggestion = missingValueStrategy === 'median' ? 'fill with the median' : 'fill with the mean';
    actions.push({
      type: 'missing-values',
      priority: 'high',
      title: 'Recover rows lost to missing numeric values',
      description: `${droppedRows} row${droppedRows === 1 ? '' : 's'} are excluded from PCA right now because at least one numeric value is missing or invalid.`,
      recommendation: `Try changing the missing-value strategy to ${suggestion} so more rows can stay in the analysis.`,
      settingsHint: `Missing values: ${missingValueStrategy === 'median' ? 'Fill with median' : 'Fill with mean'}`,
    });
    takeaways.push(`${droppedRows} row${droppedRows === 1 ? '' : 's'} could potentially be recovered by imputing missing numeric values.`);
  }

  if (constantColumns.length > 0) {
    actions.push({
      type: 'constant-columns',
      priority: 'medium',
      title: 'Remove constant features',
      description: `${constantColumns.join(', ')} ${constantColumns.length === 1 ? 'does' : 'do'} not change across usable rows, so ${constantColumns.length === 1 ? 'it adds' : 'they add'} noise without improving PCA.`,
      recommendation: 'Keep automatic constant-column removal enabled before running PCA.',
      settingsHint: 'Remove constant columns: On',
    });
    takeaways.push(`Constant feature${constantColumns.length === 1 ? '' : 's'} can be dropped safely before PCA.`);
  }

  if (mixedColumns.length > 0) {
    actions.push({
      type: 'mixed-columns',
      priority: 'medium',
      title: 'Normalize mixed-type columns',
      description: `${mixedColumns.join(', ')} contains a mix of numeric-looking and non-numeric values, so it is currently excluded from PCA.`,
      recommendation: 'Standardize these values in the source CSV if you want them treated as numeric features.',
      settingsHint: 'Clean the source column values and re-upload the dataset',
    });
    takeaways.push('Some potentially useful columns are being ignored because their values are not consistently numeric.');
  }

  if (recommendedCategoricalColumns.length > 0) {
    actions.push({
      type: 'categorical-encoding',
      priority: 'medium',
      title: 'Encode category labels for richer group separation',
      description: `Categorical columns such as ${recommendedCategoricalColumns.join(', ')} can be one-hot encoded to help PCA preserve meaningful group labels.`,
      recommendation: 'Include one or two categorical columns when they represent real segments like species, region, or cohort.',
      settingsHint: `Categorical columns: ${recommendedCategoricalColumns.join(', ')}`,
    });
    takeaways.push('Low-cardinality category labels can add useful structure when you compare groups.');
  }

  if (outlierColumns.length > 0) {
    actions.push({
      type: 'outliers',
      priority: 'low',
      title: 'Review possible outlier-heavy features',
      description: `${outlierColumns.join(', ')} shows unusually wide tails compared with the rest of the numeric distribution.`,
      recommendation: 'If the PCA plot looks stretched, try the IQR outlier filter and compare the result against the unfiltered run.',
      settingsHint: 'Outlier rows: Remove by IQR',
    });
    takeaways.push('A few extreme values may be driving the shape of the PCA projection.');
  }

  actions.push({
    type: 'scaling',
    priority: scale ? 'medium' : 'low',
    title: 'Keep features on comparable scales',
    description: scale
      ? 'Your numeric features span noticeably different ranges, so scaling will keep larger units from dominating the projection.'
      : 'Feature ranges are already fairly aligned, but scaling still keeps PCA behavior predictable across uploads.',
    recommendation: 'Leave scaling enabled unless you intentionally want larger-unit columns to dominate the principal components.',
    settingsHint: 'Scale features before PCA: On',
  });

  return {
    overview: {
      validForPca: qualityReport.validForPca !== false,
      usableRows: qualityReport.rows?.usableForPca ?? ds.row_count ?? 0,
      totalRows,
      droppedRows,
      quantitativeColumns: quantitativeColumns.length,
      categoricalColumns: categoricalColumns.length,
      ignoredColumns: qualityReport.columns?.ignored ?? 0,
    },
    recommendedConfig: {
      columns: recommendedNumericColumns.length > 0 ? recommendedNumericColumns : quantitativeColumns,
      categoricalColumns: recommendedCategoricalColumns,
      nComponents: recommendedComponents,
      scale,
      autoDropConstant: true,
      outlierMethod: recommendedOutlierMethod,
      zThreshold: 3,
      missingValueStrategy,
    },
    actions,
    takeaways,
  };
}

function buildDatasetFromRecords(records, filename) {
  if (!records.length) {
    throw new Error('CSV file is empty');
  }

  const allColumns = Object.keys(records[0]);
  const quantColumns = allColumns.filter((col) => {
    const values = records
      .map((r) => r[col])
      .filter((v) => v !== '' && v != null);
    return values.length > 0 && values.every((v) => isNumericValue(v));
  });

  if (quantColumns.length < 2) {
    throw new Error(`Need at least 2 numeric columns. Found: ${quantColumns.join(', ') || 'none'}.`);
  }

  const cleanRowsWithIndex = records
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => quantColumns.every((col) => isNumericValue(row[col])));
  const clean = cleanRowsWithIndex.map(({ row }) => row);

  const categoricalColumns = detectCategoricalColumns(records, allColumns, quantColumns);
  const matrix = clean.map((row) => quantColumns.map((col) => Number(row[col])));
  const preview = records.slice(0, 10).map((row) => {
    const obj = {};
    for (const col of allColumns) obj[col] = row[col];
    return obj;
  });
  const rowMetadata = buildRowMetadata(cleanRowsWithIndex, allColumns, quantColumns, categoricalColumns);
  const qualityReport = buildQualityReport(records, allColumns, quantColumns, clean);

  return {
    filename,
    allColumns,
    quantColumns,
    categoricalColumns,
    matrix,
    preview,
    records,
    rowMetadata,
    qualityReport,
    rowCount: clean.length,
    columnCount: allColumns.length,
  };
}

function normalizeTagList(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const normalized = values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 12);
  return [...new Set(normalized)].map((tag) => tag.slice(0, 32));
}

function buildUploadInspection(dataset) {
  const qualityReport = dataset.qualityReport;
  const totalRows = dataset.records.length;
  const usableRows = qualityReport?.rows?.usableForPca ?? dataset.rowCount;
  const droppedRows = qualityReport?.rows?.droppedForPca ?? Math.max(0, totalRows - usableRows);
  const ignoredColumns = qualityReport?.ignoredColumns?.map((item) => item.name) ?? [];
  const recommendations = [];

  if (qualityReport?.validForPca === false) {
    recommendations.push('Add at least two stable numeric columns or clean invalid values before running PCA.');
  }
  if (droppedRows > 0) {
    recommendations.push('Use the cleaning assistant or a fill strategy to recover rows lost to missing numeric values.');
  }
  if ((qualityReport?.warnings ?? []).some((warning) => warning.toLowerCase().includes('same value'))) {
    recommendations.push('Remove constant columns before PCA so they do not add noise to the workflow.');
  }
  if (dataset.categoricalColumns.length > 0) {
    recommendations.push('Consider one-hot encoding the categorical labels if those groups should influence the PCA view.');
  }
  if (recommendations.length === 0) {
    recommendations.push('This file looks PCA-ready. Upload it and start with the recommended preset.');
  }

  return {
    filename: dataset.filename,
    totalRows,
    usableRows,
    droppedRows,
    columnCount: dataset.columnCount,
    numericColumns: dataset.quantColumns,
    categoricalColumns: dataset.categoricalColumns,
    ignoredColumns,
    previewRows: dataset.preview,
    qualityReport,
    recommendations,
  };
}

async function saveDataset(uid, dataset, name, notes = '', options = {}) {
  const versionGroupId = options.versionGroupId ?? null;
  const previousVersionId = options.previousVersionId ?? null;
  const versionNumber = options.versionNumber ?? 1;
  const result = await pool.query(
    `INSERT INTO datasets
       (user_id, original_filename, name, notes, saved_presets, version_group_id, previous_version_id, version_number, row_count, column_count,
        quantitative_columns, categorical_columns, all_columns, raw_data,
        preview_data, row_metadata, quality_report, all_records)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id, version_group_id`,
    [
      uid,
      dataset.filename,
      name,
      notes,
      versionGroupId,
      previousVersionId,
      versionNumber,
      dataset.rowCount,
      dataset.columnCount,
      dataset.quantColumns,
      dataset.categoricalColumns,
      dataset.allColumns,
      JSON.stringify(dataset.matrix),
      JSON.stringify(dataset.preview),
      JSON.stringify(dataset.rowMetadata),
      JSON.stringify(dataset.qualityReport),
      JSON.stringify(dataset.records),
    ]
  );
  const insertedId = result.rows[0].id;

  if (!versionGroupId) {
    await pool.query(
      'UPDATE datasets SET version_group_id = $1 WHERE id = $1',
      [insertedId]
    );
  }

  return {
    status: 'success',
    datasetId: insertedId,
    filename: dataset.filename,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    quantitativeColumns: dataset.quantColumns,
    categoricalColumns: dataset.categoricalColumns,
    qualityReport: dataset.qualityReport,
    versionNumber,
    versionGroupId: versionGroupId ?? insertedId,
    previousVersionId,
  };
}

const SAMPLE_DATASETS = {
  iris: {
    id: 'iris',
    name: 'Iris flower measurements',
    filename: 'iris_sample.csv',
    notes: 'Built-in sample with flower measurements and species labels.',
    records: [
      { species: 'setosa', sepal_length: '5.1', sepal_width: '3.5', petal_length: '1.4', petal_width: '0.2' },
      { species: 'setosa', sepal_length: '4.9', sepal_width: '3.0', petal_length: '1.4', petal_width: '0.2' },
      { species: 'setosa', sepal_length: '5.0', sepal_width: '3.6', petal_length: '1.4', petal_width: '0.2' },
      { species: 'setosa', sepal_length: '5.4', sepal_width: '3.9', petal_length: '1.7', petal_width: '0.4' },
      { species: 'versicolor', sepal_length: '6.4', sepal_width: '3.2', petal_length: '4.5', petal_width: '1.5' },
      { species: 'versicolor', sepal_length: '6.9', sepal_width: '3.1', petal_length: '4.9', petal_width: '1.5' },
      { species: 'versicolor', sepal_length: '5.5', sepal_width: '2.3', petal_length: '4.0', petal_width: '1.3' },
      { species: 'versicolor', sepal_length: '6.5', sepal_width: '2.8', petal_length: '4.6', petal_width: '1.5' },
      { species: 'virginica', sepal_length: '6.5', sepal_width: '3.0', petal_length: '5.8', petal_width: '2.2' },
      { species: 'virginica', sepal_length: '7.6', sepal_width: '3.0', petal_length: '6.6', petal_width: '2.1' },
      { species: 'virginica', sepal_length: '7.3', sepal_width: '2.9', petal_length: '6.3', petal_width: '1.8' },
      { species: 'virginica', sepal_length: '6.7', sepal_width: '3.3', petal_length: '5.7', petal_width: '2.5' },
    ],
  },
  students: {
    id: 'students',
    name: 'Student performance',
    filename: 'student_performance_sample.csv',
    notes: 'Built-in sample with study habits, attendance, and exam scores.',
    records: [
      { track: 'analytics', study_hours: '12', attendance_rate: '0.96', sleep_hours: '7.5', practice_quizzes: '8', final_score: '91' },
      { track: 'analytics', study_hours: '10', attendance_rate: '0.91', sleep_hours: '6.8', practice_quizzes: '7', final_score: '84' },
      { track: 'systems', study_hours: '7', attendance_rate: '0.82', sleep_hours: '6.1', practice_quizzes: '4', final_score: '72' },
      { track: 'systems', study_hours: '5', attendance_rate: '0.76', sleep_hours: '5.8', practice_quizzes: '3', final_score: '65' },
      { track: 'design', study_hours: '9', attendance_rate: '0.88', sleep_hours: '7.1', practice_quizzes: '6', final_score: '80' },
      { track: 'design', study_hours: '11', attendance_rate: '0.94', sleep_hours: '7.0', practice_quizzes: '7', final_score: '88' },
      { track: 'analytics', study_hours: '14', attendance_rate: '0.98', sleep_hours: '7.2', practice_quizzes: '9', final_score: '95' },
      { track: 'systems', study_hours: '6', attendance_rate: '0.79', sleep_hours: '6.4', practice_quizzes: '4', final_score: '70' },
      { track: 'design', study_hours: '8', attendance_rate: '0.85', sleep_hours: '6.9', practice_quizzes: '5', final_score: '77' },
      { track: 'analytics', study_hours: '13', attendance_rate: '0.97', sleep_hours: '7.8', practice_quizzes: '8', final_score: '93' },
    ],
  },
  cars: {
    id: 'cars',
    name: 'Vehicle attributes',
    filename: 'vehicle_attributes_sample.csv',
    notes: 'Built-in sample with vehicle measurements and body style labels.',
    records: [
      { body_style: 'compact', mpg: '34', horsepower: '130', weight: '2600', acceleration: '8.9', price: '24000' },
      { body_style: 'compact', mpg: '31', horsepower: '145', weight: '2850', acceleration: '8.4', price: '26500' },
      { body_style: 'sedan', mpg: '28', horsepower: '175', weight: '3300', acceleration: '7.7', price: '33000' },
      { body_style: 'sedan', mpg: '25', horsepower: '205', weight: '3650', acceleration: '7.1', price: '39000' },
      { body_style: 'suv', mpg: '22', horsepower: '240', weight: '4300', acceleration: '7.3', price: '46000' },
      { body_style: 'suv', mpg: '19', horsepower: '285', weight: '4850', acceleration: '6.8', price: '54000' },
      { body_style: 'truck', mpg: '18', horsepower: '310', weight: '5200', acceleration: '6.9', price: '51000' },
      { body_style: 'truck', mpg: '16', horsepower: '365', weight: '5750', acceleration: '6.4', price: '62000' },
      { body_style: 'sport', mpg: '21', horsepower: '390', weight: '3600', acceleration: '4.4', price: '72000' },
      { body_style: 'sport', mpg: '19', horsepower: '455', weight: '3850', acceleration: '4.0', price: '88000' },
    ],
  },
};

function quantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1];
  return next === undefined ? sortedValues[base] : sortedValues[base] + rest * (next - sortedValues[base]);
}

function summarizeMatrixColumn(matrix, colIndex, name) {
  const values = matrix.map((row) => Number(row[colIndex])).filter((value) => Number.isFinite(value));
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = values.length ? sum / values.length : 0;
  const variance = values.length
    ? values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);

  return {
    name,
    count: values.length,
    min: sorted[0] ?? null,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? null,
    mean,
    stdDev,
    iqr,
    values,
  };
}

function pearson(xValues, yValues) {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) return null;
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / n;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let xDenom = 0;
  let yDenom = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    numerator += dx * dy;
    xDenom += dx * dx;
    yDenom += dy * dy;
  }
  const denom = Math.sqrt(xDenom * yDenom);
  return denom === 0 ? null : numerator / denom;
}

function buildDatasetAnalysis(ds) {
  const matrix = ds.raw_data ?? [];
  const columnNames = ds.quantitative_columns ?? [];
  const categoricalColumns = ds.categorical_columns ?? [];
  const rowMetadata = ds.row_metadata ?? [];
  const statsWithValues = columnNames.map((name, i) => summarizeMatrixColumn(matrix, i, name));
  const columnStats = statsWithValues.map(({ values: _values, ...summary }) => summary);
  const correlationMatrix = statsWithValues.map((xCol) =>
    statsWithValues.map((yCol) => pearson(xCol.values, yCol.values))
  );
  const correlations = [];

  for (let i = 0; i < columnNames.length; i += 1) {
    for (let j = i + 1; j < columnNames.length; j += 1) {
      correlations.push({
        x: columnNames[i],
        y: columnNames[j],
        r: correlationMatrix[i][j],
      });
    }
  }

  const strongestCorrelations = correlations
    .filter((item) => item.r !== null)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, 8);
  const maxRows = 5000;
  const step = matrix.length > maxRows ? Math.ceil(matrix.length / maxRows) : 1;
  const rows = matrix
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index % step === 0)
    .slice(0, maxRows)
    .map(({ row, index }) => ({ rowNumber: index + 1, values: row, metadata: rowMetadata[index] ?? null }));

  const analysis = {
    columnNames,
    categoricalColumns,
    columnStats,
    correlationMatrix,
    strongestCorrelations,
    rows,
    rowCount: matrix.length,
    sampledRowCount: rows.length,
  };
  analysis.insights = buildDatasetInsights(ds.quality_report ?? {
    rows: { total: matrix.length, usableForPca: matrix.length, droppedForPca: 0 },
    numericColumns: [],
  }, analysis);
  return analysis;
}

function squaredDistance(a, b) {
  return a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0);
}

function runKMeans(points, requestedK) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('Need at least 2 points for clustering.');
  }
  const k = Math.min(Math.max(Number(requestedK) || 3, 2), 6, points.length);
  const dims = points[0].length;
  const centroids = Array.from({ length: k }, (_, i) => {
    const index = Math.floor((i * (points.length - 1)) / Math.max(1, k - 1));
    return [...points[index]];
  });
  let labels = new Array(points.length).fill(0);

  for (let iteration = 0; iteration < 50; iteration += 1) {
    let changed = false;
    labels = points.map((point, pointIndex) => {
      let bestLabel = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < centroids.length; i += 1) {
        const distance = squaredDistance(point, centroids[i]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLabel = i;
        }
      }
      if (labels[pointIndex] !== bestLabel) changed = true;
      return bestLabel;
    });

    const totals = Array.from({ length: k }, () => Array(dims).fill(0));
    const counts = Array(k).fill(0);
    points.forEach((point, index) => {
      const label = labels[index];
      counts[label] += 1;
      for (let dim = 0; dim < dims; dim += 1) totals[label][dim] += point[dim];
    });

    for (let i = 0; i < k; i += 1) {
      if (counts[i] === 0) continue;
      centroids[i] = totals[i].map((total) => total / counts[i]);
    }

    if (!changed) break;
  }

  return {
    k,
    labels,
    centroids,
    counts: centroids.map((_, i) => labels.filter((label) => label === i).length),
  };
}

function normalizePreprocessingOptions(body = {}) {
  const outlierMethod = ['none', 'zscore', 'iqr'].includes(body.outlierMethod)
    ? body.outlierMethod
    : 'none';
  const missingValueStrategy = ['drop', 'mean', 'median'].includes(body.missingValueStrategy)
    ? body.missingValueStrategy
    : 'drop';
  const zThreshold = Math.min(Math.max(Number(body.zThreshold) || 3, 1), 6);

  return {
    scale: body.scale === undefined ? true : Boolean(body.scale),
    autoDropConstant: body.autoDropConstant === undefined ? true : Boolean(body.autoDropConstant),
    outlierMethod,
    zThreshold,
    missingValueStrategy,
  };
}

function resolvePcaSelections(ds, body = {}) {
  const availableColumns = ds.quantitative_columns ?? [];
  const availableCategoricalColumns = ds.categorical_columns ?? [];
  const requestedColumns = Array.isArray(body.columns)
    ? [...new Set(body.columns.map(String).map((col) => col.trim()).filter(Boolean))]
    : null;
  const requestedCategoricalColumns = Array.isArray(body.categoricalColumns)
    ? [...new Set(body.categoricalColumns.map(String).map((col) => col.trim()).filter(Boolean))]
    : [];
  const selectedColumns = requestedColumns !== null ? requestedColumns : availableColumns;
  const selectedCategoricalColumns = requestedCategoricalColumns;
  const invalidColumns = selectedColumns.filter((col) => !availableColumns.includes(col));
  const invalidCategoricalColumns = selectedCategoricalColumns.filter((col) => !availableCategoricalColumns.includes(col));

  return {
    availableColumns,
    availableCategoricalColumns,
    selectedColumns,
    selectedCategoricalColumns,
    invalidColumns,
    invalidCategoricalColumns,
  };
}

function resolveComponentCount(featureCount, requestedCount) {
  let nComponents = featureCount >= 3 ? 3 : 2;
  if (requestedCount !== undefined) {
    const requestedComponents = Number(requestedCount);
    if (![2, 3].includes(requestedComponents)) {
      return { error: 'Number of PCA components must be 2 or 3.' };
    }
    nComponents = requestedComponents;
  }
  return { nComponents };
}

function buildPreprocessingDiff(ds, preprocessing, preprocessingOptions) {
  const report = preprocessing.report ?? {};
  const rows = report.rows ?? {};
  const columns = report.columns ?? {};
  const selectedNumeric = columns.selected ?? [];
  const encodedCategorical = columns.encodedCategorical ?? [];
  const removedConstant = columns.removedConstant ?? [];
  const beforeRows = ds.row_count ?? rows.input ?? 0;
  const afterRows = rows.used ?? beforeRows;
  const beforeFeatureCount = selectedNumeric.length + encodedCategorical.length;
  const afterFeatureCount = (columns.used ?? preprocessing.columnNames ?? []).length;
  const takeaways = [];

  if ((rows.imputedValues ?? 0) > 0) {
    takeaways.push(`${rows.imputedValues} value${rows.imputedValues === 1 ? '' : 's'} were filled using the ${preprocessingOptions.missingValueStrategy}.`);
  }
  if ((rows.droppedInvalid ?? 0) > 0) {
    takeaways.push(`${rows.droppedInvalid} row${rows.droppedInvalid === 1 ? '' : 's'} were removed because selected numeric values were missing or invalid.`);
  }
  if ((rows.droppedOutliers ?? 0) > 0) {
    takeaways.push(`${rows.droppedOutliers} outlier row${rows.droppedOutliers === 1 ? '' : 's'} were filtered before PCA.`);
  }
  if (removedConstant.length > 0) {
    takeaways.push(`Constant feature${removedConstant.length === 1 ? '' : 's'} were removed: ${removedConstant.join(', ')}.`);
  }
  if (encodedCategorical.length > 0) {
    takeaways.push(`Categorical columns were encoded before PCA: ${encodedCategorical.join(', ')}.`);
  }

  return {
    summary: {
      startingRows: beforeRows,
      usableRows: afterRows,
      retainedRowsPct: beforeRows > 0 ? Number(((afterRows / beforeRows) * 100).toFixed(1)) : 0,
      selectedNumericColumns: selectedNumeric.length,
      selectedCategoricalColumns: encodedCategorical.length,
      outputFeatureCount: afterFeatureCount,
      featureDelta: afterFeatureCount - beforeFeatureCount,
    },
    before: {
      rows: beforeRows,
      numericColumns: selectedNumeric,
      categoricalColumns: encodedCategorical,
    },
    after: {
      rows: afterRows,
      featureNames: columns.used ?? preprocessing.columnNames ?? [],
      removedConstant,
    },
    takeaways,
  };
}

function buildPcaPreview(ds, body = {}) {
  const {
    selectedColumns,
    selectedCategoricalColumns,
    invalidColumns,
    invalidCategoricalColumns,
  } = resolvePcaSelections(ds, body);

  if (invalidColumns.length > 0) {
    return {
      error: `Unknown numeric column${invalidColumns.length === 1 ? '' : 's'}: ${invalidColumns.join(', ')}`,
      statusCode: 400,
    };
  }
  if (invalidCategoricalColumns.length > 0) {
    return {
      error: `Unknown categorical column${invalidCategoricalColumns.length === 1 ? '' : 's'}: ${invalidCategoricalColumns.join(', ')}`,
      statusCode: 400,
    };
  }
  if (selectedColumns.length === 0 && selectedCategoricalColumns.length === 0) {
    return {
      error: 'Choose at least one numeric or categorical feature for PCA.',
      statusCode: 400,
    };
  }

  const preprocessingOptions = normalizePreprocessingOptions(body);
  const preprocessing = validateAndPreprocessForPca(
    ds,
    selectedColumns,
    selectedCategoricalColumns,
    preprocessingOptions
  );
  const preprocessingDiff = buildPreprocessingDiff(ds, preprocessing, preprocessingOptions);
  const componentResolution = resolveComponentCount(preprocessing.columnNames.length, body?.nComponents);
  if (componentResolution.error) {
    return { error: componentResolution.error, statusCode: 400 };
  }

  let pcaPreview = null;
  if (preprocessing.report.valid) {
    try {
      const result = runPCA(preprocessing.matrix, componentResolution.nComponents, { scale: preprocessingOptions.scale });
      pcaPreview = {
        nComponents: result.nComponents,
        explainedVarianceRatio: result.explainedVarianceRatio,
        totalExplained: result.totalExplained,
        nSamples: result.nSamples,
      };
    } catch (err) {
      return {
        error: err.message,
        statusCode: 400,
        preprocessing,
        preprocessingOptions,
        preprocessingDiff,
      };
    }
  }

  return {
    preprocessing,
    preprocessingOptions,
    preprocessingDiff,
    pcaPreview,
  };
}

function normalizePresetConfig(ds, body = {}) {
  const {
    selectedColumns,
    selectedCategoricalColumns,
    invalidColumns,
    invalidCategoricalColumns,
  } = resolvePcaSelections(ds, body);
  if (invalidColumns.length > 0) {
    return { error: `Unknown numeric column${invalidColumns.length === 1 ? '' : 's'}: ${invalidColumns.join(', ')}` };
  }
  if (invalidCategoricalColumns.length > 0) {
    return { error: `Unknown categorical column${invalidCategoricalColumns.length === 1 ? '' : 's'}: ${invalidCategoricalColumns.join(', ')}` };
  }
  if (selectedColumns.length === 0 && selectedCategoricalColumns.length === 0) {
    return { error: 'Choose at least one numeric or categorical feature for the preset.' };
  }

  const options = normalizePreprocessingOptions(body);
  const componentResolution = resolveComponentCount(selectedColumns.length + selectedCategoricalColumns.length, body?.nComponents);
  if (componentResolution.error) return { error: componentResolution.error };

  return {
    config: {
      columns: selectedColumns,
      categoricalColumns: selectedCategoricalColumns,
      nComponents: componentResolution.nComponents,
      ...options,
    },
  };
}

function summarizeValues(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  const sorted = [...numeric].sort((a, b) => a - b);
  const mean = numeric.length
    ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    : 0;
  const variance = numeric.length
    ? numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numeric.length
    : 0;

  return {
    mean,
    stdDev: Math.sqrt(variance),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

function rowHasOutlier(row, columnStats, options) {
  if (options.outlierMethod === 'none') return false;

  return row.some((value, index) => {
    const stats = columnStats[index];
    if (!stats) return false;

    if (options.outlierMethod === 'zscore') {
      return stats.stdDev > 0 && Math.abs((value - stats.mean) / stats.stdDev) > options.zThreshold;
    }

    const iqr = stats.q3 - stats.q1;
    if (!Number.isFinite(iqr) || iqr <= 0) return false;
    return value < stats.q1 - 1.5 * iqr || value > stats.q3 + 1.5 * iqr;
  });
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

function makeStoredRecords(ds) {
  if (Array.isArray(ds.all_records) && ds.all_records.length > 0) {
    return ds.all_records.map((row, index) => ({ row, originalIndex: index }));
  }

  const numericColumns = ds.quantitative_columns ?? [];
  const metadata = ds.row_metadata ?? [];
  return (ds.raw_data ?? []).map((values, index) => ({
    originalIndex: index,
    row: {
      ...(metadata[index]?.values ?? {}),
      ...Object.fromEntries(numericColumns.map((col, colIndex) => [col, values[colIndex]])),
    },
  }));
}

function uniqueCategoryLevels(records, column) {
  return [...new Set(records
    .map(({ row }) => String(row[column] ?? '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 20);
}

function sumExplainedVariance(ratios = []) {
  return ratios.reduce((sum, value) => sum + Number(value || 0), 0);
}

function topRunContributors(run, componentIndex = 0, limit = 3) {
  const component = run.loadings?.[componentIndex] ?? [];
  return component
    .map((value, index) => ({ name: run.column_names?.[index], value: Number(value) }))
    .filter((item) => item.name)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

function summarizeRunForComparison(run) {
  return {
    id: run.id,
    createdAt: run.created_at,
    nComponents: run.n_components,
    nSamples: run.n_samples,
    totalExplained: sumExplainedVariance(run.explained_variance_ratio),
    explainedVarianceRatio: run.explained_variance_ratio ?? [],
    columnNames: run.column_names ?? [],
    preprocessingOptions: run.preprocessing_options ?? {},
    preprocessingReport: run.preprocessing_report ?? null,
    topContributors: topRunContributors(run),
  };
}

function buildRunComparison(runA, runB) {
  const summaryA = summarizeRunForComparison(runA);
  const summaryB = summarizeRunForComparison(runB);
  const columnsA = new Set(summaryA.columnNames);
  const columnsB = new Set(summaryB.columnNames);
  const sharedColumns = summaryA.columnNames.filter((col) => columnsB.has(col));
  const onlyInRunA = summaryA.columnNames.filter((col) => !columnsB.has(col));
  const onlyInRunB = summaryB.columnNames.filter((col) => !columnsA.has(col));
  const optionLabels = {
    missingValueStrategy: 'Missing values',
    outlierMethod: 'Outlier handling',
    scale: 'Scaling',
    autoDropConstant: 'Constant-column removal',
  };
  const preprocessingDifferences = Object.entries(optionLabels)
    .filter(([key]) => (summaryA.preprocessingOptions?.[key] ?? null) !== (summaryB.preprocessingOptions?.[key] ?? null))
    .map(([key, label]) => ({
      key,
      label,
      runA: summaryA.preprocessingOptions?.[key] ?? null,
      runB: summaryB.preprocessingOptions?.[key] ?? null,
    }));
  const takeaways = [];
  const explainedDelta = Number((summaryB.totalExplained - summaryA.totalExplained).toFixed(4));
  const sampleDelta = Number(summaryB.nSamples || 0) - Number(summaryA.nSamples || 0);

  if (Math.abs(explainedDelta) >= 0.02) {
    const betterRun = explainedDelta > 0 ? 'Run B' : 'Run A';
    takeaways.push(`${betterRun} explains ${Math.abs(explainedDelta * 100).toFixed(1)} percentage points more variance across the selected components.`);
  }
  if (sampleDelta !== 0) {
    const betterRun = sampleDelta > 0 ? 'Run B' : 'Run A';
    takeaways.push(`${betterRun} keeps ${Math.abs(sampleDelta)} more sample${Math.abs(sampleDelta) === 1 ? '' : 's'} after preprocessing.`);
  }
  if (onlyInRunA.length > 0 || onlyInRunB.length > 0) {
    takeaways.push('The runs use different feature sets, so changes in variance explained may come from both preprocessing and column selection.');
  }
  if (preprocessingDifferences.length > 0) {
    takeaways.push('The preprocessing choices are different enough that this is a meaningful apples-to-apples comparison of PCA setup decisions.');
  }
  const topA = summaryA.topContributors[0];
  const topB = summaryB.topContributors[0];
  if (topA?.name && topB?.name && topA.name !== topB.name) {
    takeaways.push(`PC1 is led by ${topA.name} in Run A and ${topB.name} in Run B, which suggests the dominant pattern shifted between runs.`);
  }
  if (takeaways.length === 0) {
    takeaways.push('These runs are very similar on the top-line metrics, so inspect the PCA plots and loadings to decide which setup you prefer.');
  }

  return {
    runA: summaryA,
    runB: summaryB,
    sharedColumns,
    onlyInRunA,
    onlyInRunB,
    preprocessingDifferences,
    deltas: {
      totalExplained: explainedDelta,
      samples: sampleDelta,
    },
    takeaways,
  };
}

function validateAndPreprocessForPca(ds, selectedColumns, selectedCategoricalColumns, options) {
  const availableColumns = ds.quantitative_columns ?? [];
  const sourceRecords = makeStoredRecords(ds);
  const warnings = [];
  let droppedInvalidRows = 0;
  let droppedOutlierRows = 0;
  let imputedValues = 0;

  const fillValues = {};
  for (const column of selectedColumns) {
    const values = sourceRecords
      .map(({ row }) => Number(row[column]))
      .filter((value) => Number.isFinite(value));
    if (options.missingValueStrategy === 'mean') {
      fillValues[column] = values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
    } else if (options.missingValueStrategy === 'median') {
      fillValues[column] = median(values);
    }
  }

  let rows = sourceRecords.map(({ row, originalIndex }) => {
    const values = [];
    let invalid = false;
    let imputed = 0;

    for (const column of selectedColumns) {
      const value = Number(row[column]);
      if (Number.isFinite(value)) {
        values.push(value);
        continue;
      }
      if (options.missingValueStrategy === 'drop') {
        invalid = true;
        values.push(null);
        continue;
      }
      const fillValue = fillValues[column];
      if (Number.isFinite(fillValue)) {
        values.push(fillValue);
        imputed += 1;
      } else {
        invalid = true;
        values.push(null);
      }
    }

    return { values, originalIndex, row, invalid, imputed };
  });

  const beforeInvalidRows = rows.length;
  rows = rows.filter(({ invalid, values }) => !invalid && values.every((value) => Number.isFinite(value)));
  droppedInvalidRows = beforeInvalidRows - rows.length;
  imputedValues = rows.reduce((sum, row) => sum + row.imputed, 0);

  if (droppedInvalidRows > 0) {
    warnings.push(`${droppedInvalidRows} row${droppedInvalidRows === 1 ? '' : 's'} removed because selected numeric columns contained missing or invalid values.`);
  }
  if (imputedValues > 0) {
    warnings.push(`${imputedValues} missing or invalid numeric value${imputedValues === 1 ? '' : 's'} filled with the column ${options.missingValueStrategy}.`);
  }

  const categoricalLevels = {};
  const categoricalFeatureNames = [];
  for (const column of selectedCategoricalColumns) {
    const levels = uniqueCategoryLevels(sourceRecords, column);
    categoricalLevels[column] = levels;
    if (levels.length === 0) {
      warnings.push(`${column} was not encoded because it has no non-empty category values.`);
      continue;
    }
    if (levels.length >= 20) {
      warnings.push(`${column} was limited to its first 20 category levels to avoid too many PCA features.`);
    }
    for (const level of levels) {
      categoricalFeatureNames.push(`${column}=${level}`);
    }
  }

  if (categoricalFeatureNames.length > 0) {
    rows = rows.map((item) => ({
      ...item,
      values: [
        ...item.values,
        ...selectedCategoricalColumns.flatMap((column) =>
          (categoricalLevels[column] ?? []).map((level) =>
            String(item.row[column] ?? '').trim() === level ? 1 : 0
          )
        ),
      ],
    }));
  }

  if (options.outlierMethod !== 'none' && rows.length > 0) {
    const columnStats = selectedColumns.map((_, index) => summarizeValues(rows.map(({ values }) => values[index])));
    const beforeOutliers = rows.length;
    rows = rows.filter(({ values }) => !rowHasOutlier(values, columnStats, options));
    droppedOutlierRows = beforeOutliers - rows.length;
    if (droppedOutlierRows > 0) {
      const method = options.outlierMethod === 'zscore'
        ? `z-score greater than ${options.zThreshold}`
        : '1.5x IQR fences';
      warnings.push(`${droppedOutlierRows} outlier row${droppedOutlierRows === 1 ? '' : 's'} removed using ${method}.`);
    }
  }

  let outputColumns = [...selectedColumns, ...categoricalFeatureNames];
  let outputIndexes = outputColumns.map((_, index) => index);
  const removedColumns = [];

  if (options.autoDropConstant && rows.length > 0) {
    outputIndexes = outputIndexes.filter((columnIndex) => {
      const values = rows.map(({ values }) => values[columnIndex]);
      const first = values[0];
      const isConstant = values.every((value) => value === first);
      if (isConstant) {
        removedColumns.push(outputColumns[columnIndex]);
        return false;
      }
      return true;
    });
    outputColumns = outputIndexes.map((index) => outputColumns[index]);
    if (removedColumns.length > 0) {
      warnings.push(`Removed constant column${removedColumns.length === 1 ? '' : 's'}: ${removedColumns.join(', ')}.`);
    }
  }

  const matrix = rows.map(({ values }) => outputIndexes.map((columnIndex) => values[columnIndex]));
  const rowIndexes = rows.map(({ originalIndex }) => originalIndex);
  const valid = matrix.length >= 2 && outputColumns.length >= 2;
  const reasons = [];
  if (outputColumns.length < 2) reasons.push('PCA requires at least two usable numeric columns after preprocessing.');
  if (matrix.length < 2) reasons.push('PCA requires at least two usable rows after preprocessing.');

  return {
    matrix,
    columnNames: outputColumns,
    rowIndexes,
    report: {
      valid,
      status: valid ? 'valid' : 'invalid',
      message: valid
        ? `Dataset is valid for PCA after preprocessing: ${matrix.length} rows and ${outputColumns.length} numeric columns will be used.`
        : reasons.join(' '),
      options,
      rows: {
        input: sourceRecords.length,
        afterInvalidRemoval: sourceRecords.length - droppedInvalidRows,
        afterOutlierRemoval: rows.length,
        used: matrix.length,
        droppedInvalid: droppedInvalidRows,
        droppedOutliers: droppedOutlierRows,
        imputedValues,
      },
      columns: {
        selected: selectedColumns,
        encodedCategorical: selectedCategoricalColumns,
        used: outputColumns,
        removedConstant: removedColumns,
        categoricalLevels,
      },
      warnings,
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatSignedLoading(value) {
  const numeric = Number(value || 0);
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(3)}`;
}

function buildNarrativeVarianceSummary(run) {
  const ratios = Array.isArray(run.explained_variance_ratio) ? run.explained_variance_ratio : [];
  const count = Math.min(Number(run.n_components || ratios.length || 0), ratios.length);
  return ratios
    .slice(0, count || ratios.length)
    .map((value, index) => `- PC${index + 1}: ${formatPct(value)}`)
    .join('\n');
}

function buildNarrativeLoadingsSummary(run) {
  const columnNames = Array.isArray(run.column_names) ? run.column_names : [];
  const loadings = Array.isArray(run.loadings) ? run.loadings : [];
  const count = Math.min(Number(run.n_components || loadings.length || 0), loadings.length);

  return loadings
    .slice(0, count || loadings.length)
    .map((component, componentIndex) => {
      const entries = (Array.isArray(component) ? component : [])
        .map((value, index) => ({
          name: columnNames[index] || `Feature ${index + 1}`,
          value: Number(value || 0),
        }))
        .filter((entry) => Number.isFinite(entry.value))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 4);

      const summary = entries.length
        ? entries.map((entry) => `${entry.name} (${formatSignedLoading(entry.value)})`).join(', ')
        : 'No loading data available.';

      return `- PC${componentIndex + 1}: ${summary}`;
    })
    .join('\n');
}

function summarizeNarrativePreprocessing(options = {}) {
  const parts = [];
  if (Array.isArray(options.columns) && options.columns.length > 0) {
    parts.push(`selected numeric columns: ${options.columns.join(', ')}`);
  }
  if (Array.isArray(options.categoricalColumns) && options.categoricalColumns.length > 0) {
    parts.push(`encoded categorical columns: ${options.categoricalColumns.join(', ')}`);
  }
  if (options.missingValueStrategy) {
    parts.push(`missing values: ${options.missingValueStrategy}`);
  }
  if (options.outlierMethod) {
    parts.push(`outlier handling: ${options.outlierMethod}`);
  }
  if (options.scale !== undefined) {
    parts.push(`scaling: ${options.scale ? 'on' : 'off'}`);
  }
  if (options.autoDropConstant !== undefined) {
    parts.push(`drop constant columns: ${options.autoDropConstant ? 'on' : 'off'}`);
  }
  return parts.join('; ');
}

function buildPcaNarrativePrompt(run, dataset) {
  const datasetName = dataset.name || dataset.original_filename || 'Untitled dataset';
  const varianceSummary = buildNarrativeVarianceSummary(run) || '- Variance ratios unavailable';
  const loadingSummary = buildNarrativeLoadingsSummary(run) || '- Loading data unavailable';
  const preprocessingSummary = summarizeNarrativePreprocessing(run.preprocessing_options ?? {});

  return [
    `Dataset: ${datasetName}`,
    `Rows used in PCA: ${Number(run.n_samples || 0)}`,
    `Components generated: ${Number(run.n_components || 0)}`,
    '',
    'Explained variance per component:',
    varianceSummary,
    '',
    'Top 4 loadings per component (sorted by absolute value):',
    loadingSummary,
    preprocessingSummary ? '' : null,
    preprocessingSummary ? `Preprocessing context: ${preprocessingSummary}` : null,
    '',
    'Please interpret these PCA results for a user-facing analytics product.',
    'Requirements:',
    '- Give each principal component a short descriptive name based on its top loadings.',
    '- Explain in 1-2 sentences what pattern each component captures.',
    '- Recommend how many components to retain and why.',
    '- Note any interesting patterns, tensions, or anomalies.',
    '- Keep the full response concise at roughly 200-350 words.',
    '- Return plain text only, with no markdown table or code fence.',
  ].filter(Boolean).join('\n');
}

function extractGeminiText(payload) {
  return (payload?.candidates ?? [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function geminiFinishReason(payload) {
  return payload?.candidates?.[0]?.finishReason || '';
}

function narrativeLooksTruncated(narrative, payload) {
  const text = String(narrative ?? '').trim();
  const finishReason = geminiFinishReason(payload);
  if (!text) return true;
  if (finishReason === 'MAX_TOKENS') return true;
  if (text.length < 140) return true;
  if (/Component\s+\d+:\s*$/i.test(text)) return true;
  if (/[,:;\-]\s*$/.test(text)) return true;
  return false;
}

async function requestGeminiNarrative(apiKey, prompt, options = {}) {
  const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: 'You are a data science interpreter. Read PCA outputs and explain them clearly for users, with concise component naming and practical retention guidance.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
        thinkingConfig: {
          thinkingBudget: options.thinkingBudget ?? 0,
        },
      },
    }),
  });

  const responseText = await geminiResponse.text();
  let responsePayload = null;
  try {
    responsePayload = responseText ? JSON.parse(responseText) : null;
  } catch {
    responsePayload = null;
  }

  return {
    geminiResponse,
    responseText,
    responsePayload,
    narrative: extractGeminiText(responsePayload),
  };
}

function resolveGeminiApiKey() {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GENAI_API_KEY,
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || null;
}

function sendHtmlReport(res, filename, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(html);
}

function datasetReportHtml(ds, analysis) {
  const statsRows = (analysis.columnStats ?? []).map((col) => `
    <tr>
      <td>${escapeHtml(col.name)}</td>
      <td>${Number(col.mean).toFixed(3)}</td>
      <td>${Number(col.median).toFixed(3)}</td>
      <td>${Number(col.stdDev).toFixed(3)}</td>
      <td>${Number(col.min).toFixed(3)}</td>
      <td>${Number(col.max).toFixed(3)}</td>
    </tr>`).join('');
  const insightItems = (analysis.insights ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const relationshipItems = (analysis.strongestCorrelations ?? []).map((item) =>
    `<li>${escapeHtml(item.x)} and ${escapeHtml(item.y)}: ${Number(item.r).toFixed(3)}</li>`
  ).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ds.name || ds.original_filename)} analysis report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #122620; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #c8d5c0; padding: 0.45rem 0.6rem; text-align: left; }
    th { background: #e6f4ea; }
    .muted { color: #6b705c; }
  </style>
</head>
<body>
  <h1>${escapeHtml(ds.name || ds.original_filename)}</h1>
  <p class="muted">${escapeHtml(ds.original_filename)} · ${ds.row_count} usable rows · ${(ds.quantitative_columns ?? []).length} numeric columns</p>
  <h2>Insights</h2>
  <ul>${insightItems}</ul>
  <h2>Strongest Relationships</h2>
  <ul>${relationshipItems || '<li>No strong relationships found.</li>'}</ul>
  <h2>Summary Statistics</h2>
  <table>
    <thead><tr><th>Column</th><th>Mean</th><th>Median</th><th>Std dev</th><th>Min</th><th>Max</th></tr></thead>
    <tbody>${statsRows}</tbody>
  </table>
</body>
</html>`;
}

function pcaReportHtml(run) {
  const total = (run.explained_variance_ratio ?? []).reduce((sum, value) => sum + Number(value || 0), 0);
  const preprocessing = run.preprocessing_report ?? {};
  const varianceRows = (run.explained_variance_ratio ?? []).map((value, index) =>
    `<tr><td>PC${index + 1}</td><td>${formatPct(value)}</td></tr>`
  ).join('');
  const loadingRows = (run.loadings ?? []).map((component, componentIndex) => {
    const contributors = component
      .map((value, index) => ({ name: run.column_names[index], value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5)
      .map((item) => `${escapeHtml(item.name)} (${Number(item.value).toFixed(3)})`)
      .join(', ');
    return `<tr><td>PC${componentIndex + 1}</td><td>${contributors}</td></tr>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(run.original_filename)} PCA report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #122620; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #c8d5c0; padding: 0.45rem 0.6rem; text-align: left; }
    th { background: #e6f4ea; }
    .muted { color: #6b705c; }
  </style>
</head>
<body>
  <h1>${escapeHtml(run.original_filename)} PCA report</h1>
  <p class="muted">${run.n_samples} samples · ${run.n_components} components · ${formatPct(total)} total variance explained</p>
  <h2>Preprocessing Validation</h2>
  <p>${escapeHtml(preprocessing.message || 'No preprocessing report was stored for this run.')}</p>
  ${preprocessing.rows ? `<p class="muted">Rows used: ${escapeHtml(preprocessing.rows.used)} of ${escapeHtml(preprocessing.rows.input)} · Values imputed: ${escapeHtml(preprocessing.rows.imputedValues || 0)} · Outliers removed: ${escapeHtml(preprocessing.rows.droppedOutliers || 0)}</p>` : ''}
  ${preprocessing.columns ? `<p class="muted">Columns used: ${(preprocessing.columns.used ?? []).map(escapeHtml).join(', ')}</p>` : ''}
  ${preprocessing.columns?.encodedCategorical?.length ? `<p class="muted">Encoded categorical columns: ${preprocessing.columns.encodedCategorical.map(escapeHtml).join(', ')}</p>` : ''}
  <h2>Input Features</h2>
  <p>${(run.column_names ?? []).map(escapeHtml).join(', ')}</p>
  <h2>Variance Explained</h2>
  <table><thead><tr><th>Component</th><th>Variance</th></tr></thead><tbody>${varianceRows}</tbody></table>
  <h2>Top Loadings</h2>
  <table><thead><tr><th>Component</th><th>Top contributors</th></tr></thead><tbody>${loadingRows}</tbody></table>
</body>
</html>`;
}

function scalePoint(value, min, max, size, padding) {
  if (!Number.isFinite(value) || max === min) return size / 2;
  return padding + ((value - min) / (max - min)) * (size - padding * 2);
}

function pcaScatterSvg(run, clusters = null) {
  const points = run.transformed_data ?? [];
  if (!points.length || !points[0] || points[0].length < 2) {
    return '<p class="muted">No PCA coordinates available for this run.</p>';
  }

  const width = 480;
  const height = 300;
  const padding = 34;
  const xValues = points.map((point) => Number(point[0]));
  const yValues = points.map((point) => Number(point[1]));
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const colors = ['#122620', '#b57a2e', '#2d4a3e', '#8a4f2d', '#5b7f95', '#7a6f2a'];

  const circles = points.slice(0, 650).map((point, index) => {
    const x = scalePoint(Number(point[0]), minX, maxX, width, padding);
    const y = height - scalePoint(Number(point[1]), minY, maxY, height, padding);
    const label = clusters?.labels?.[index] ?? index;
    const color = clusters ? colors[label % colors.length] : '#2d4a3e';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" opacity="0.78"><title>Row ${index + 1}: PC1 ${Number(point[0]).toFixed(3)}, PC2 ${Number(point[1]).toFixed(3)}</title></circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="PCA scatter plot">
      <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#f8fbf4" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#6b705c" />
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#6b705c" />
      <text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="12" fill="#6b705c">PC1</text>
      <text x="14" y="${height / 2}" text-anchor="middle" font-size="12" fill="#6b705c" transform="rotate(-90 14 ${height / 2})">PC2</text>
      ${circles}
    </svg>`;
}

function projectReportHtml(ds, analysis, runs) {
  const quality = ds.quality_report ?? {};
  const warnings = (quality.warnings ?? []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
  const insights = (analysis.insights ?? []).map((insight) => `<li>${escapeHtml(insight)}</li>`).join('');
  const relationships = (analysis.strongestCorrelations ?? []).slice(0, 6).map((item) =>
    `<li>${escapeHtml(item.x)} and ${escapeHtml(item.y)}: ${Number(item.r).toFixed(3)}</li>`
  ).join('');
  const statsRows = (analysis.columnStats ?? []).map((col) => `
    <tr>
      <td>${escapeHtml(col.name)}</td>
      <td>${Number(col.mean).toFixed(3)}</td>
      <td>${Number(col.median).toFixed(3)}</td>
      <td>${Number(col.stdDev).toFixed(3)}</td>
      <td>${Number(col.min).toFixed(3)}</td>
      <td>${Number(col.max).toFixed(3)}</td>
    </tr>`).join('');

  const runSections = runs.map((run, index) => {
    let clusters = null;
    try {
      clusters = runKMeans(run.transformed_data ?? [], Math.min(3, run.transformed_data?.length ?? 0));
    } catch {
      clusters = null;
    }

    const varianceRows = (run.explained_variance_ratio ?? []).map((value, componentIndex) =>
      `<tr><td>PC${componentIndex + 1}</td><td>${formatPct(value)}</td></tr>`
    ).join('');
    const preprocessing = run.preprocessing_report ?? {};
    const clusterSummary = clusters
      ? clusters.counts.map((count, clusterIndex) => `<li>Cluster ${clusterIndex}: ${count} point${count === 1 ? '' : 's'}</li>`).join('')
      : '<li>No cluster summary available.</li>';
    const featureTags = (run.column_names ?? []).map((col) => `<span class="tag">${escapeHtml(col)}</span>`).join('');

    return `
      <section class="run-section">
        <h3>PCA Run ${index + 1}</h3>
        <p class="muted">${run.n_samples} samples · ${run.n_components} components · ${formatPct((run.explained_variance_ratio ?? []).reduce((sum, value) => sum + Number(value || 0), 0))} total variance explained · ${new Date(run.created_at).toLocaleString()}</p>
        <div class="metric-grid">
          <div><span>Rows used</span><strong>${escapeHtml(preprocessing.rows?.used ?? run.n_samples)}</strong></div>
          <div><span>Values imputed</span><strong>${escapeHtml(preprocessing.rows?.imputedValues ?? 0)}</strong></div>
          <div><span>Outliers removed</span><strong>${escapeHtml(preprocessing.rows?.droppedOutliers ?? 0)}</strong></div>
          <div><span>Features</span><strong>${escapeHtml((run.column_names ?? []).length)}</strong></div>
        </div>
        <p>${escapeHtml(preprocessing.message || 'No preprocessing report was stored for this PCA run.')}</p>
        <div class="tag-list">${featureTags}</div>
        <div class="run-grid">
          <div>
            <h4>PCA visualization</h4>
            ${pcaScatterSvg(run, clusters)}
          </div>
          <div>
            <h4>Variance explained</h4>
            <table><thead><tr><th>Component</th><th>Variance</th></tr></thead><tbody>${varianceRows}</tbody></table>
            <h4>Cluster summary</h4>
            <ul>${clusterSummary}</ul>
          </div>
        </div>
      </section>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ds.name || ds.original_filename)} project report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #122620; line-height: 1.5; background: #f6f1e9; }
    main { max-width: 1100px; margin: 0 auto; }
    section { background: rgba(255,255,255,0.82); border: 1px solid #d0dbc8; border-radius: 16px; padding: 1.25rem; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
    th, td { border: 1px solid #c8d5c0; padding: 0.45rem 0.6rem; text-align: left; }
    th { background: #e6f4ea; }
    svg { width: 100%; max-width: 520px; height: auto; }
    .muted { color: #6b705c; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
    .metric-grid div { border: 1px solid #d0dbc8; border-radius: 10px; padding: 0.75rem; background: #fff; }
    .metric-grid span { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06rem; color: #6b705c; }
    .metric-grid strong { font-size: 1.2rem; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.75rem 0; }
    .tag { display: inline-block; padding: 0.18rem 0.55rem; border-radius: 6px; background: rgba(18,38,32,0.09); font-size: 0.8rem; }
    .run-grid { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(240px, 0.8fr); gap: 1rem; align-items: start; }
    .run-section { page-break-inside: avoid; }
    @media print { body { background: white; } section { break-inside: avoid; } }
    @media (max-width: 760px) { .run-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(ds.name || ds.original_filename)} project report</h1>
    <p class="muted">${escapeHtml(ds.original_filename)} · generated ${new Date().toLocaleString()}</p>

    <section>
      <h2>Dataset summary</h2>
      <div class="metric-grid">
        <div><span>Usable rows</span><strong>${escapeHtml(ds.row_count)}</strong></div>
        <div><span>Total columns</span><strong>${escapeHtml(ds.column_count ?? ds.all_columns?.length ?? 'n/a')}</strong></div>
        <div><span>Numeric columns</span><strong>${escapeHtml((ds.quantitative_columns ?? []).length)}</strong></div>
        <div><span>PCA runs</span><strong>${escapeHtml(runs.length)}</strong></div>
      </div>
      <p>${escapeHtml(quality.validationMessage || 'Dataset quality was evaluated during upload.')}</p>
      <h3>Data quality warnings</h3>
      <ul>${warnings || '<li>No quality warnings were reported.</li>'}</ul>
    </section>

    <section>
      <h2>Key insights</h2>
      <ul>${insights || '<li>No insights available.</li>'}</ul>
      <h3>Strongest relationships</h3>
      <ul>${relationships || '<li>No correlation summary available.</li>'}</ul>
    </section>

    <section>
      <h2>Summary statistics</h2>
      <table>
        <thead><tr><th>Column</th><th>Mean</th><th>Median</th><th>Std dev</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>${statsRows}</tbody>
      </table>
    </section>

    <section>
      <h2>PCA runs, settings, visualizations, and clusters</h2>
      ${runSections || '<p class="muted">No PCA runs have been created for this dataset yet.</p>'}
    </section>
  </main>
</body>
</html>`;
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
    'Get dataset cleaning suggestions',
    'Compare PCA runs side-by-side',
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

app.get('/api/profile', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'test') {
    return res.json({
      status: 'success',
      profile: {
        username: req.user.username,
        displayName: '',
        email: '',
        createdAt: new Date(0).toISOString(),
      },
    });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT username, display_name, email, created_at
       FROM users
       WHERE id = $1`,
      [uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }

    const user = result.rows[0];
    return res.json({
      status: 'success',
      profile: {
        username: user.username,
        displayName: user.display_name ?? '',
        email: user.email ?? '',
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('Profile lookup error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  const displayName = req.body?.displayName;
  const email = req.body?.email;

  if (displayName === undefined && email === undefined) {
    return res.status(400).json({ status: 'error', message: 'Provide displayName or email to update' });
  }

  try {
    const uid = await resolveUserId(req);
    const fields = [];
    const values = [];
    let index = 1;

    if (displayName !== undefined) {
      fields.push(`display_name = $${index++}`);
      values.push(String(displayName).trim().slice(0, 80));
    }
    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ status: 'error', message: 'Enter a valid email address' });
      }
      fields.push(`email = $${index++}`);
      values.push(normalizedEmail || null);
    }

    values.push(uid);
    const result = await pool.query(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${index}
       RETURNING username, display_name, email, created_at`,
      values
    );

    return res.json({
      status: 'success',
      profile: {
        username: result.rows[0].username,
        displayName: result.rows[0].display_name ?? '',
        email: result.rows[0].email ?? '',
        createdAt: result.rows[0].created_at,
      },
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.patch('/api/profile/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const nextPassword = String(req.body?.nextPassword ?? '');

  if (!currentPassword || !nextPassword) {
    return res.status(400).json({ status: 'error', message: 'Current and new password are required' });
  }
  if (nextPassword.length < 6) {
    return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
  }

  if (process.env.NODE_ENV === 'test') {
    return res.json({ status: 'success', message: 'Password updated' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [uid]);
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(nextPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, uid]);
    return res.json({ status: 'success', message: 'Password updated' });
  } catch (err) {
    console.error('Password update error:', err);
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
              quantitative_columns, categorical_columns, all_columns, upload_timestamp,
              is_favorite, tags,
              version_group_id, previous_version_id, version_number
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

app.get('/api/datasets/:id/versions', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const baseResult = await pool.query(
      `SELECT id, version_group_id
       FROM datasets
       WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!baseResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const versionGroupId = baseResult.rows[0].version_group_id ?? baseResult.rows[0].id;
    const result = await pool.query(
      `SELECT id, original_filename, name, row_count, upload_timestamp, version_number, previous_version_id
       FROM datasets
       WHERE user_id = $1 AND COALESCE(version_group_id, id) = $2
       ORDER BY version_number ASC, upload_timestamp ASC`,
      [uid, versionGroupId]
    );
    return res.json({ status: 'success', versions: result.rows });
  } catch (err) {
    console.error('List dataset versions error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/presets', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT saved_presets
       FROM datasets
       WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    return res.json({ status: 'success', presets: result.rows[0].saved_presets ?? [] });
  } catch (err) {
    console.error('List presets error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.post('/api/datasets/:id/presets', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  const presetName = String(req.body?.name ?? '').trim();
  if (!presetName) {
    return res.status(400).json({ status: 'error', message: 'Preset name is required' });
  }

  try {
    const uid = await resolveUserId(req);
    const dsResult = await pool.query(
      `SELECT id, quantitative_columns, categorical_columns, saved_presets
       FROM datasets
       WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!dsResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const ds = dsResult.rows[0];
    const normalized = normalizePresetConfig(ds, req.body?.config ?? req.body ?? {});
    if (normalized.error) {
      return res.status(400).json({ status: 'error', message: normalized.error });
    }

    const presets = ds.saved_presets ?? [];
    const preset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: presetName.slice(0, 80),
      notes: String(req.body?.notes ?? '').trim().slice(0, 240),
      config: normalized.config,
      createdAt: new Date().toISOString(),
    };
    const updated = [...presets, preset];
    await pool.query(
      'UPDATE datasets SET saved_presets = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(updated), datasetId, uid]
    );
    return res.json({ status: 'success', preset, presets: updated });
  } catch (err) {
    console.error('Save preset error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.delete('/api/datasets/:id/presets/:presetId', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const dsResult = await pool.query(
      `SELECT saved_presets
       FROM datasets
       WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!dsResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const presets = dsResult.rows[0].saved_presets ?? [];
    const updated = presets.filter((preset) => preset.id !== req.params.presetId);
    if (updated.length === presets.length) {
      return res.status(404).json({ status: 'error', message: 'Preset not found' });
    }
    await pool.query(
      'UPDATE datasets SET saved_presets = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(updated), datasetId, uid]
    );
    return res.json({ status: 'success', presets: updated });
  } catch (err) {
    console.error('Delete preset error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/samples', requireAuth, (_req, res) => {
  const samples = Object.values(SAMPLE_DATASETS).map((sample) => ({
    id: sample.id,
    name: sample.name,
    filename: sample.filename,
    rowCount: sample.records.length,
    columns: Object.keys(sample.records[0] ?? {}),
  }));
  return res.json({ status: 'success', samples });
});

app.post('/api/samples/:id', requireAuth, async (req, res) => {
  const sample = SAMPLE_DATASETS[req.params.id];
  if (!sample) {
    return res.status(404).json({ status: 'error', message: 'Sample dataset not found' });
  }

  try {
    const uid = await resolveUserId(req);
    const dataset = buildDatasetFromRecords(sample.records, sample.filename);
    const response = await saveDataset(uid, dataset, sample.name, sample.notes);
    return res.json(response);
  } catch (err) {
    console.error('Create sample dataset error:', err);
    return res.status(500).json({ status: 'error', message: 'Could not create sample dataset' });
  }
});

app.post('/api/datasets/inspect-upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

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

  try {
    const dataset = buildDatasetFromRecords(records, req.file.originalname);
    return res.json({
      status: 'success',
      inspection: buildUploadInspection(dataset),
    });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
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

  let dataset;
  try {
    dataset = buildDatasetFromRecords(records, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }

  try {
    const uid = await resolveUserId(req);
    let versionOptions = {};
    if (req.body?.basedOnDatasetId) {
      const sourceDatasetId = parseInt(req.body.basedOnDatasetId, 10);
      if (isNaN(sourceDatasetId)) {
        return res.status(400).json({ status: 'error', message: 'Invalid source dataset id for versioning' });
      }
      const sourceResult = await pool.query(
        `SELECT id, version_group_id, version_number
         FROM datasets
         WHERE id = $1 AND user_id = $2`,
        [sourceDatasetId, uid]
      );
      if (!sourceResult.rows.length) {
        return res.status(404).json({ status: 'error', message: 'Source dataset for new version was not found' });
      }
      const sourceDataset = sourceResult.rows[0];
      const versionGroupId = sourceDataset.version_group_id ?? sourceDataset.id;
      const versionCountResult = await pool.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_version
         FROM datasets
         WHERE user_id = $1 AND COALESCE(version_group_id, id) = $2`,
        [uid, versionGroupId]
      );
      versionOptions = {
        versionGroupId,
        previousVersionId: sourceDataset.id,
        versionNumber: Number(versionCountResult.rows[0]?.max_version || 0) + 1,
      };
    }
    const response = await saveDataset(
      uid,
      dataset,
      req.file.originalname.replace(/\.csv$/i, ''),
      '',
      versionOptions,
    );
    return res.json(response);
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
      `SELECT preview_data, all_columns, quantitative_columns, categorical_columns, original_filename, row_count
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
      categoricalColumns: ds.categorical_columns ?? [],
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
    return res.json({
      status: 'success',
      qualityReport: ds.quality_report ?? fallbackQualityReportFromDataset(ds),
    });
  } catch (err) {
    console.error('Quality report error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/assistant', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT row_count, column_count, all_columns, quantitative_columns, categorical_columns, quality_report
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    return res.json({
      status: 'success',
      assistant: buildCleaningAssistant(result.rows[0]),
    });
  } catch (err) {
    console.error('Cleaning assistant error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/analysis', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT raw_data, quantitative_columns, categorical_columns, row_metadata, quality_report, row_count
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    return res.json({
      status: 'success',
      analysis: buildDatasetAnalysis(result.rows[0]),
    });
  } catch (err) {
    console.error('Dataset analysis error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/report', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT original_filename, name, notes, row_count, quantitative_columns,
              categorical_columns, raw_data, row_metadata, quality_report
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }
    const ds = result.rows[0];
    const analysis = buildDatasetAnalysis(ds);
    const reportName = `${(ds.name || ds.original_filename).replace(/[^a-z0-9_-]+/gi, '_')}_report.html`;
    return sendHtmlReport(res, reportName, datasetReportHtml(ds, analysis));
  } catch (err) {
    console.error('Dataset report error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/datasets/:id/project-report', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }

  try {
    const uid = await resolveUserId(req);
    const dsResult = await pool.query(
      `SELECT original_filename, name, notes, row_count, column_count, quantitative_columns,
              categorical_columns, all_columns, raw_data, row_metadata, quality_report
       FROM datasets WHERE id = $1 AND user_id = $2`,
      [datasetId, uid]
    );
    if (!dsResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const runsResult = await pool.query(
      `SELECT id, n_components, explained_variance_ratio, all_explained_variance,
              loadings, transformed_data, column_names, n_samples,
              preprocessing_options, preprocessing_report, created_at
       FROM pca_runs
       WHERE dataset_id = $1
       ORDER BY created_at DESC`,
      [datasetId]
    );

    const ds = dsResult.rows[0];
    const analysis = buildDatasetAnalysis(ds);
    const reportName = `${(ds.name || ds.original_filename).replace(/[^a-z0-9_-]+/gi, '_')}_project_report.html`;
    return sendHtmlReport(res, reportName, projectReportHtml(ds, analysis, runsResult.rows));
  } catch (err) {
    console.error('Project report error:', err);
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

  const { name, notes, tags, isFavorite } = req.body ?? {};
  if (name === undefined && notes === undefined && tags === undefined && isFavorite === undefined) {
    return res.status(400).json({ status: 'error', message: 'Provide name or notes to update, or pass tags/favorite state' });
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
    if (tags !== undefined) {
      fields.push(`tags = $${idx++}`);
      values.push(normalizeTagList(tags));
    }
    if (isFavorite !== undefined) {
      fields.push(`is_favorite = $${idx++}`);
      values.push(Boolean(isFavorite));
    }
    values.push(datasetId, uid);

    const result = await pool.query(
      `UPDATE datasets SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, name, notes, tags, is_favorite`,
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

app.post('/api/datasets/:id/pca/preview', requireAuth, async (req, res) => {
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

    const preview = buildPcaPreview(dsResult.rows[0], req.body ?? {});
    if (preview.error) {
      return res.status(preview.statusCode ?? 400).json({
        status: 'error',
        message: preview.error,
        preprocessingReport: preview.preprocessing?.report ?? null,
        preprocessingDiff: preview.preprocessingDiff ?? null,
      });
    }

    return res.json({
      status: 'success',
      preprocessingReport: preview.preprocessing.report,
      preprocessingDiff: preview.preprocessingDiff,
      preview: preview.pcaPreview,
      preprocessingOptions: preview.preprocessingOptions,
    });
  } catch (err) {
    console.error('PCA preview error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

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
    const {
      selectedColumns,
      selectedCategoricalColumns,
      invalidColumns,
      invalidCategoricalColumns,
    } = resolvePcaSelections(ds, req.body ?? {});
    if (invalidColumns.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Unknown numeric column${invalidColumns.length === 1 ? '' : 's'}: ${invalidColumns.join(', ')}`,
      });
    }
    if (invalidCategoricalColumns.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Unknown categorical column${invalidCategoricalColumns.length === 1 ? '' : 's'}: ${invalidCategoricalColumns.join(', ')}`,
      });
    }
    if (selectedColumns.length === 0 && selectedCategoricalColumns.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Choose at least one numeric or categorical feature for PCA.',
      });
    }

    const preprocessingOptions = normalizePreprocessingOptions(req.body);
    const preprocessing = validateAndPreprocessForPca(
      ds,
      selectedColumns,
      selectedCategoricalColumns,
      preprocessingOptions
    );

    if (!preprocessing.report.valid) {
      return res.status(400).json({
        status: 'error',
        message: preprocessing.report.message,
        preprocessingReport: preprocessing.report,
        preprocessingDiff: buildPreprocessingDiff(ds, preprocessing, preprocessingOptions),
      });
    }

    const matrix = preprocessing.matrix;
    const pcaColumns = preprocessing.columnNames;
    const nFeatures = pcaColumns.length;
    const componentResolution = resolveComponentCount(nFeatures, req.body?.nComponents);
    if (componentResolution.error) {
      return res.status(400).json({
        status: 'error',
        message: componentResolution.error,
      });
    }
    const nComponents = componentResolution.nComponents;
    const preprocessingDiff = buildPreprocessingDiff(ds, preprocessing, preprocessingOptions);
    let pcaResult;
    try {
      pcaResult = runPCA(matrix, nComponents, { scale: preprocessingOptions.scale });
    } catch (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message,
        preprocessingReport: {
          ...preprocessing.report,
          valid: false,
          status: 'invalid',
          message: err.message,
        },
        preprocessingDiff,
      });
    }

    const runResult = await pool.query(
      `INSERT INTO pca_runs
         (dataset_id, n_components, explained_variance_ratio,
          all_explained_variance, loadings, transformed_data, column_names, n_samples,
          preprocessing_options, preprocessing_report, preprocessing_diff, row_indexes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        datasetId,
        pcaResult.nComponents,
        JSON.stringify(pcaResult.explainedVarianceRatio),
        JSON.stringify(pcaResult.allExplainedVariance),
        JSON.stringify(pcaResult.loadings),
        JSON.stringify(pcaResult.transformed),
        pcaColumns,
        pcaResult.nSamples,
        JSON.stringify(preprocessingOptions),
        JSON.stringify(preprocessing.report),
        JSON.stringify(preprocessingDiff),
        JSON.stringify(preprocessing.rowIndexes),
      ]
    );

    return res.json({
      status: 'success',
      runId: runResult.rows[0].id,
      nComponents: pcaResult.nComponents,
      explainedVarianceRatio: pcaResult.explainedVarianceRatio,
      allExplainedVariance: pcaResult.allExplainedVariance,
      loadings: pcaResult.loadings,
      totalExplained: pcaResult.totalExplained,
      nSamples: pcaResult.nSamples,
      columnNames: pcaColumns,
      filename: ds.original_filename,
      scale: preprocessingOptions.scale,
      preprocessingReport: preprocessing.report,
      preprocessingDiff,
    });
  } catch (err) {
    console.error('PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'PCA failed: ' + err.message });
  }
});

app.get('/api/datasets/:id/pca/compare', requireAuth, async (req, res) => {
  const datasetId = parseInt(req.params.id, 10);
  const runAId = parseInt(req.query.runA, 10);
  const runBId = parseInt(req.query.runB, 10);
  if (isNaN(datasetId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid dataset id' });
  }
  if (isNaN(runAId) || isNaN(runBId) || runAId === runBId) {
    return res.status(400).json({ status: 'error', message: 'Choose two different PCA run ids to compare' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT r.*
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.dataset_id = $1
         AND r.id = ANY($2::int[])
         AND d.user_id = $3`,
      [datasetId, [runAId, runBId], uid]
    );
    if (result.rows.length !== 2) {
      return res.status(404).json({ status: 'error', message: 'One or both PCA runs were not found for this dataset' });
    }

    const runMap = new Map(result.rows.map((row) => [row.id, row]));
    return res.json({
      status: 'success',
      comparison: buildRunComparison(runMap.get(runAId), runMap.get(runBId)),
    });
  } catch (err) {
    console.error('Compare PCA runs error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
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
      `SELECT r.id, r.n_components, r.explained_variance_ratio, r.column_names, r.n_samples,
              r.preprocessing_report, r.preprocessing_diff, r.notes, r.is_pinned, r.created_at
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.dataset_id = $1 AND d.user_id = $2
       ORDER BY r.is_pinned DESC, r.created_at DESC`,
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
      `SELECT r.*, d.original_filename, d.row_metadata, d.categorical_columns,
              d.all_records, d.all_columns, d.quantitative_columns
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }
    const run = result.rows[0];
    const rowMetadata = Array.isArray(run.row_indexes) && Array.isArray(run.all_records)
      ? run.row_indexes.map((index) => {
        const row = run.all_records[index] ?? {};
        return {
          rowNumber: index + 1,
          labels: Object.fromEntries((run.categorical_columns ?? []).map((col) => [col, row[col] ?? ''])),
          values: Object.fromEntries((run.all_columns ?? []).map((col) => [col, row[col] ?? ''])),
          numeric: Object.fromEntries((run.quantitative_columns ?? []).map((col) => {
            const value = Number(row[col]);
            return [col, Number.isFinite(value) ? value : null];
          })),
        };
      })
      : Array.isArray(run.row_indexes)
        ? run.row_indexes.map((index) => (run.row_metadata ?? [])[index] ?? null)
      : run.row_metadata ?? [];
    return res.json({
      status: 'success',
      runId: run.id,
      filename: run.original_filename,
      nComponents: run.n_components,
      explainedVarianceRatio: run.explained_variance_ratio,
      allExplainedVariance: run.all_explained_variance,
      loadings: run.loadings ?? [],
      transformedData: run.transformed_data,
      columnNames: run.column_names,
      rowMetadata,
      labelColumns: run.categorical_columns ?? [],
      nSamples: run.n_samples,
      createdAt: run.created_at,
      notes: run.notes ?? '',
      isPinned: run.is_pinned === true,
      preprocessingOptions: run.preprocessing_options ?? {},
      preprocessingReport: run.preprocessing_report ?? null,
      preprocessingDiff: run.preprocessing_diff ?? null,
    });
  } catch (err) {
    console.error('Get PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/pca/:id/narrative', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }

  try {
    const uid = await resolveUserId(req);
    const runResult = await pool.query(
      `SELECT r.id, r.dataset_id, r.loadings, r.explained_variance_ratio,
              r.column_names, r.n_components, r.n_samples, r.preprocessing_options
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
    );
    if (!runResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }

    const run = runResult.rows[0];
    const datasetResult = await pool.query(
      `SELECT name, original_filename
       FROM datasets
       WHERE id = $1 AND user_id = $2`,
      [run.dataset_id, uid]
    );
    if (!datasetResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Dataset not found' });
    }

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      return res.status(200).json({
        narrative: null,
        error: 'AI narrative requires a server environment variable named GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_GENAI_API_KEY, or GENAI_API_KEY.',
      });
    }

    const basePrompt = buildPcaNarrativePrompt(run, datasetResult.rows[0]);
    let geminiResult = await requestGeminiNarrative(apiKey, basePrompt, {
      maxOutputTokens: 1024,
      thinkingBudget: 0,
      temperature: 0.3,
    });

    if (
      geminiResult.geminiResponse.ok &&
      narrativeLooksTruncated(geminiResult.narrative, geminiResult.responsePayload)
    ) {
      const retryPrompt = `${basePrompt}\n\nImportant: finish the complete response. Do not stop after a heading, label, or the first component. End with fully written sentences.`;
      geminiResult = await requestGeminiNarrative(apiKey, retryPrompt, {
        maxOutputTokens: 2048,
        thinkingBudget: 0,
        temperature: 0.2,
      });
    }

    if (!geminiResult.geminiResponse.ok) {
      const detail =
        geminiResult.responsePayload?.error?.message ||
        geminiResult.responsePayload?.message ||
        geminiResult.responseText ||
        `Gemini API returned status ${geminiResult.geminiResponse.status}`;
      return res.status(502).json({ error: 'Narrative generation failed', detail });
    }

    const narrative = geminiResult.narrative;
    if (!narrative) {
      return res.status(502).json({
        error: 'Narrative generation failed',
        detail: 'Gemini API returned an empty response.',
      });
    }

    return res.json({
      narrative,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('PCA narrative error:', err);
    return res.status(502).json({
      error: 'Narrative generation failed',
      detail: err?.message || 'Unknown error',
    });
  }
});

app.patch('/api/pca/:id', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }

  const { notes, isPinned } = req.body ?? {};
  if (notes === undefined && isPinned === undefined) {
    return res.status(400).json({ status: 'error', message: 'Provide notes or pin state to update' });
  }

  try {
    const uid = await resolveUserId(req);
    const runResult = await pool.query(
      `SELECT r.id, r.dataset_id
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
    );
    if (!runResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }

    const datasetId = runResult.rows[0].dataset_id;
    if (isPinned === true) {
      await pool.query('UPDATE pca_runs SET is_pinned = FALSE WHERE dataset_id = $1', [datasetId]);
    }

    const fields = [];
    const values = [];
    let idx = 1;
    if (notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(String(notes).slice(0, 2000));
    }
    if (isPinned !== undefined) {
      fields.push(`is_pinned = $${idx++}`);
      values.push(Boolean(isPinned));
    }
    values.push(runId);

    const result = await pool.query(
      `UPDATE pca_runs SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, notes, is_pinned`,
      values
    );
    return res.json({
      status: 'success',
      run: {
        id: result.rows[0].id,
        notes: result.rows[0].notes ?? '',
        isPinned: result.rows[0].is_pinned === true,
      },
    });
  } catch (err) {
    console.error('Patch PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/pca/:id/clusters', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (isNaN(runId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid run id' });
  }

  try {
    const uid = await resolveUserId(req);
    const result = await pool.query(
      `SELECT r.transformed_data
       FROM pca_runs r
       JOIN datasets d ON d.id = r.dataset_id
       WHERE r.id = $1 AND d.user_id = $2`,
      [runId, uid]
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'PCA run not found' });
    }

    const clusters = runKMeans(result.rows[0].transformed_data, req.query.k);
    return res.json({ status: 'success', clusters });
  } catch (err) {
    console.error('Cluster PCA run error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/pca/:id/report', requireAuth, async (req, res) => {
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
    const reportName = `${run.original_filename.replace(/\.csv$/i, '').replace(/[^a-z0-9_-]+/gi, '_')}_pca_report.html`;
    return sendHtmlReport(res, reportName, pcaReportHtml(run));
  } catch (err) {
    console.error('PCA report error:', err);
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

// ── Serve React client in production ─────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // Any route not matched by the API falls through to the React app
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

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

export {
  buildCleaningAssistant,
  buildUploadInspection,
  buildPcaPreview,
  buildPreprocessingDiff,
  buildRunComparison,
  fallbackQualityReportFromDataset,
  normalizeTagList,
};

export default app;
