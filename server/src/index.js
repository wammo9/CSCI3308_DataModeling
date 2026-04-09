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
 * GET    /api/datasets/:id/preview   first 10 rows of dataset   [auth]
 * PATCH  /api/datasets/:id           rename / add notes         [auth]
 * GET    /api/datasets/:id/quality   dataset quality report     [auth]
 * GET    /api/datasets/:id/analysis  numeric analysis data      [auth]
 * GET    /api/datasets/:id/report    download analysis report   [auth]
 * DELETE /api/datasets/:id           delete dataset + PCA runs  [auth]
 * POST   /api/datasets/:id/pca      run PCA on a dataset       [auth]
 * GET    /api/datasets/:id/pca      list PCA runs for dataset   [auth]
 * GET    /api/pca/:id               fetch a single PCA result   [auth]
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
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS categorical_columns TEXT[]');
  await pool.query('ALTER TABLE datasets ADD COLUMN IF NOT EXISTS row_metadata JSONB');
  await pool.query('ALTER TABLE pca_runs ADD COLUMN IF NOT EXISTS loadings JSONB');
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

  if (clean.length < 2) {
    throw new Error('Not enough valid rows after removing rows with missing values.');
  }

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
    rowMetadata,
    qualityReport,
    rowCount: clean.length,
    columnCount: allColumns.length,
  };
}

async function saveDataset(uid, dataset, name, notes = '') {
  const result = await pool.query(
    `INSERT INTO datasets
       (user_id, original_filename, name, notes, row_count, column_count,
        quantitative_columns, categorical_columns, all_columns, raw_data,
        preview_data, row_metadata, quality_report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      uid,
      dataset.filename,
      name,
      notes,
      dataset.rowCount,
      dataset.columnCount,
      dataset.quantColumns,
      dataset.categoricalColumns,
      dataset.allColumns,
      JSON.stringify(dataset.matrix),
      JSON.stringify(dataset.preview),
      JSON.stringify(dataset.rowMetadata),
      JSON.stringify(dataset.qualityReport),
    ]
  );

  return {
    status: 'success',
    datasetId: result.rows[0].id,
    filename: dataset.filename,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    quantitativeColumns: dataset.quantColumns,
    categoricalColumns: dataset.categoricalColumns,
    qualityReport: dataset.qualityReport,
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
  <h2>Input Features</h2>
  <p>${(run.column_names ?? []).map(escapeHtml).join(', ')}</p>
  <h2>Variance Explained</h2>
  <table><thead><tr><th>Component</th><th>Variance</th></tr></thead><tbody>${varianceRows}</tbody></table>
  <h2>Top Loadings</h2>
  <table><thead><tr><th>Component</th><th>Top contributors</th></tr></thead><tbody>${loadingRows}</tbody></table>
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
              quantitative_columns, categorical_columns, all_columns, upload_timestamp
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
    const response = await saveDataset(
      uid,
      dataset,
      req.file.originalname.replace(/\.csv$/i, ''),
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
          all_explained_variance, loadings, transformed_data, column_names, n_samples)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        datasetId,
        pcaResult.nComponents,
        JSON.stringify(pcaResult.explainedVarianceRatio),
        JSON.stringify(pcaResult.allExplainedVariance),
        JSON.stringify(pcaResult.loadings),
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
      loadings: pcaResult.loadings,
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
      `SELECT r.*, d.original_filename, d.row_metadata, d.categorical_columns
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
      loadings: run.loadings ?? [],
      transformedData: run.transformed_data,
      columnNames: run.column_names,
      rowMetadata: run.row_metadata ?? [],
      labelColumns: run.categorical_columns ?? [],
      nSamples: run.n_samples,
      createdAt: run.created_at,
    });
  } catch (err) {
    console.error('Get PCA run error:', err);
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
