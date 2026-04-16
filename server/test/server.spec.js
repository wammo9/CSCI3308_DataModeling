/**
 * ModelScope — server unit tests
 *
 * Run with:  NODE_ENV=test npm test   (from the server/ directory)
 *
 * NODE_ENV=test causes the /register route to skip the database so these
 * tests run without a live Postgres instance, matching the course lab pattern.
 */

import { strict as assert } from 'assert';
import request from 'supertest';
import app, {
  buildCleaningAssistant,
  buildUploadInspection,
  buildPcaPreview,
  buildPreprocessingDiff,
  buildRunComparison,
  normalizeTagList,
} from '../src/index.js';

let server;

before((done) => {
  server = app.listen(0, '127.0.0.1', done);
});

after((done) => {
  if (!server) return done();
  return server.close(done);
});

// Helper: generate a valid JWT for auth-protected route tests
async function makeToken() {
  const { default: jwt } = await import('jsonwebtoken');
  return jwt.sign(
    { username: 'tester', userId: 999 },
    process.env.JWT_SECRET || 'dev-secret-change-in-production',
    { expiresIn: '1h' }
  );
}

// ── Default welcome endpoint ──────────────────────────────────────────────────

describe('Server', () => {
  it('GET /welcome returns the default welcome message', async () => {
    const res = await request(server).get('/welcome');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.message, 'Welcome!');
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('Testing Register API', () => {
  // Positive case: valid username + password → 200 + "Success"
  it('positive : /register — valid input returns 200 and Success', async () => {
    const res = await request(server)
      .post('/register')
      .send({ username: 'testuser', password: 'password123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Success');
  });

  // Negative case: missing password / wrong type → 400 + "Invalid input"
  it('negative : /register — invalid input returns 400 and Invalid input', async () => {
    const res = await request(server)
      .post('/register')
      .send({ username: 12345 }); // not a string, missing password
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Invalid input');
  });

  // Negative case: password too short
  it('negative : /register — short password returns 400', async () => {
    const res = await request(server)
      .post('/register')
      .send({ username: 'testuser', password: '123' });
    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes('password'));
  });
});

// ── Redirect & render stubs ───────────────────────────────────────────────────

describe('Testing Redirect', () => {
  it('GET /test redirects to /login with 302', async () => {
    const res = await request(server).get('/test').redirects(0);
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.endsWith('/login'));
  });
});

describe('Testing Render', () => {
  it('GET /login responds with HTML and status 200', async () => {
    const res = await request(server).get('/login');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('html'));
  });
});

// ── Auth protection ───────────────────────────────────────────────────────────

describe('Auth-protected routes', () => {
  it('GET /api/datasets without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets');
    assert.equal(res.status, 401);
  });

  it('POST /api/datasets/upload without a token returns 401', async () => {
    const res = await request(server).post('/api/datasets/upload');
    assert.equal(res.status, 401);
  });

  it('GET /api/datasets/1/preview without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets/1/preview');
    assert.equal(res.status, 401);
  });

  it('DELETE /api/datasets/1 without a token returns 401', async () => {
    const res = await request(server).delete('/api/datasets/1');
    assert.equal(res.status, 401);
  });

  it('DELETE /api/pca/1 without a token returns 401', async () => {
    const res = await request(server).delete('/api/pca/1');
    assert.equal(res.status, 401);
  });

  it('PATCH /api/datasets/1 without a token returns 401', async () => {
    const res = await request(server).patch('/api/datasets/1');
    assert.equal(res.status, 401);
  });

  it('GET /api/pca/1/export without a token returns 401', async () => {
    const res = await request(server).get('/api/pca/1/export');
    assert.equal(res.status, 401);
  });

  it('GET /api/datasets/1/assistant without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets/1/assistant');
    assert.equal(res.status, 401);
  });

  it('GET /api/datasets/1/pca/compare without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets/1/pca/compare?runA=1&runB=2');
    assert.equal(res.status, 401);
  });

  it('GET /api/profile without a token returns 401', async () => {
    const res = await request(server).get('/api/profile');
    assert.equal(res.status, 401);
  });

  it('POST /api/datasets/inspect-upload without a token returns 401', async () => {
    const res = await request(server).post('/api/datasets/inspect-upload');
    assert.equal(res.status, 401);
  });

  it('GET /api/datasets/1/versions without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets/1/versions');
    assert.equal(res.status, 401);
  });

  it('GET /api/datasets/1/presets without a token returns 401', async () => {
    const res = await request(server).get('/api/datasets/1/presets');
    assert.equal(res.status, 401);
  });

  it('POST /api/datasets/1/pca/preview without a token returns 401', async () => {
    const res = await request(server).post('/api/datasets/1/pca/preview');
    assert.equal(res.status, 401);
  });

  it('PATCH /api/pca/1 without a token returns 401', async () => {
    const res = await request(server).patch('/api/pca/1');
    assert.equal(res.status, 401);
  });
});

// ── CSV upload validation ────────────────────────────────────────────────────

describe('Upload validation', () => {
  it('POST /api/datasets/upload with a valid token but no file returns 400', async () => {
    const token = await makeToken();
    const res = await request(server)
      .post('/api/datasets/upload')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes('no file'));
  });
});

// ── PATCH validation ─────────────────────────────────────────────────────────

describe('Dataset rename/notes validation', () => {
  it('PATCH /api/datasets/:id with empty body returns 400', async () => {
    const token = await makeToken();
    const res = await request(server)
      .patch('/api/datasets/1')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes('name or notes'));
  });
});

// ── Export validation ────────────────────────────────────────────────────────

describe('Export PCA results', () => {
  it('GET /api/pca/invalid/export with non-numeric id returns 400', async () => {
    const token = await makeToken();
    const res = await request(server)
      .get('/api/pca/abc/export')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes('invalid'));
  });
});

// ── Health & features ────────────────────────────────────────────────────────

describe('API info routes', () => {
  it('GET /api/health returns ok status', async () => {
    const res = await request(server).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('GET /api/features returns an array of features', async () => {
    const res = await request(server).get('/api/features');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 3);
  });
});

describe('Cleaning assistant summary', () => {
  it('recommends imputation, constant-column removal, and scaling when the dataset needs cleanup', () => {
    const assistant = buildCleaningAssistant({
      row_count: 10,
      quantitative_columns: ['age', 'score', 'constant'],
      categorical_columns: ['group'],
      quality_report: {
        validForPca: true,
        rows: { total: 10, usableForPca: 8, droppedForPca: 2 },
        columns: { ignored: 1 },
        numericColumns: [
          { name: 'age', min: 18, max: 62, mean: 34, stdDev: 10, isConstant: false },
          { name: 'score', min: 50, max: 650, mean: 110, stdDev: 60, isConstant: false },
          { name: 'constant', min: 1, max: 1, mean: 1, stdDev: 0, isConstant: true },
        ],
        ignoredColumns: [
          { name: 'mixed_values', numericLikeCount: 7, missingCount: 1 },
        ],
      },
    });

    assert.equal(assistant.recommendedConfig.missingValueStrategy, 'median');
    assert.equal(assistant.recommendedConfig.autoDropConstant, true);
    assert.equal(assistant.recommendedConfig.scale, true);
    assert.equal(assistant.recommendedConfig.outlierMethod, 'iqr');
    assert.deepEqual(assistant.recommendedConfig.columns, ['age', 'score']);
    assert.deepEqual(assistant.recommendedConfig.categoricalColumns, ['group']);
    assert.ok(assistant.actions.some((action) => action.type === 'missing-values'));
    assert.ok(assistant.actions.some((action) => action.type === 'constant-columns'));
    assert.ok(assistant.actions.some((action) => action.type === 'mixed-columns'));
  });
});

describe('Upload inspection summary', () => {
  it('summarizes readiness, row counts, and recommendations for a parsed dataset', () => {
    const inspection = buildUploadInspection({
      filename: 'example.csv',
      records: [
        { a: '1', b: '2' },
        { a: '3', b: '' },
        { a: '4', b: '5' },
      ],
      rowCount: 2,
      columnCount: 2,
      quantColumns: ['a', 'b'],
      categoricalColumns: [],
      preview: [{ a: '1', b: '2' }],
      qualityReport: {
        validForPca: true,
        validationMessage: 'Dataset is valid for PCA.',
        rows: { usableForPca: 2, droppedForPca: 1 },
        ignoredColumns: [],
        warnings: ['1 row excluded from PCA due to missing values.'],
      },
    });

    assert.equal(inspection.totalRows, 3);
    assert.equal(inspection.usableRows, 2);
    assert.equal(inspection.droppedRows, 1);
    assert.ok(Array.isArray(inspection.recommendations));
    assert.ok(inspection.recommendations.some((item) => item.toLowerCase().includes('fill strategy')));
  });
});

describe('Tag normalization', () => {
  it('deduplicates, trims, and caps dataset tags', () => {
    const tags = normalizeTagList(['  baseline ', 'reporting', 'baseline', '', 'qa']);
    assert.deepEqual(tags, ['baseline', 'reporting', 'qa']);
  });
});

describe('PCA run comparison summary', () => {
  it('captures differences in variance, samples, columns, and preprocessing choices', () => {
    const comparison = buildRunComparison(
      {
        id: 101,
        created_at: '2026-04-10T10:00:00.000Z',
        n_components: 2,
        n_samples: 80,
        explained_variance_ratio: [0.41, 0.18],
        column_names: ['age', 'score'],
        preprocessing_options: {
          missingValueStrategy: 'drop',
          outlierMethod: 'none',
          scale: true,
          autoDropConstant: true,
        },
        preprocessing_report: { message: 'Run A preprocessing summary' },
        loadings: [[0.9, 0.1], [0.3, 0.7]],
      },
      {
        id: 102,
        created_at: '2026-04-10T10:05:00.000Z',
        n_components: 3,
        n_samples: 92,
        explained_variance_ratio: [0.36, 0.21, 0.14],
        column_names: ['age', 'score', 'attendance'],
        preprocessing_options: {
          missingValueStrategy: 'median',
          outlierMethod: 'iqr',
          scale: true,
          autoDropConstant: true,
        },
        preprocessing_report: { message: 'Run B preprocessing summary' },
        loadings: [[0.2, 0.1, 0.8], [0.5, 0.4, 0.1], [0.1, 0.8, 0.1]],
      }
    );

    assert.equal(comparison.deltas.samples, 12);
    assert.equal(comparison.deltas.totalExplained, 0.12);
    assert.deepEqual(comparison.sharedColumns, ['age', 'score']);
    assert.deepEqual(comparison.onlyInRunA, []);
    assert.deepEqual(comparison.onlyInRunB, ['attendance']);
    assert.ok(comparison.preprocessingDifferences.some((item) => item.key === 'missingValueStrategy'));
    assert.ok(comparison.preprocessingDifferences.some((item) => item.key === 'outlierMethod'));
    assert.ok(comparison.takeaways.length >= 3);
  });
});

describe('Preprocessing diff summary', () => {
  it('summarizes before/after row and feature changes', () => {
    const diff = buildPreprocessingDiff(
      { row_count: 12 },
      {
        columnNames: ['age', 'score', 'group=A', 'group=B'],
        report: {
          rows: { input: 12, used: 9, droppedInvalid: 2, droppedOutliers: 1, imputedValues: 3 },
          columns: {
            selected: ['age', 'score'],
            encodedCategorical: ['group'],
            used: ['age', 'score', 'group=A', 'group=B'],
            removedConstant: ['constant_col'],
          },
        },
      },
      { missingValueStrategy: 'mean' }
    );

    assert.equal(diff.summary.startingRows, 12);
    assert.equal(diff.summary.usableRows, 9);
    assert.equal(diff.summary.outputFeatureCount, 4);
    assert.ok(diff.takeaways.some((item) => item.includes('filled using the mean')));
    assert.ok(diff.takeaways.some((item) => item.includes('Constant feature')));
  });
});

describe('PCA preview builder', () => {
  it('creates a dry-run preview with preprocessing and variance estimates', () => {
    const preview = buildPcaPreview(
      {
        row_count: 6,
        quantitative_columns: ['x', 'y', 'z'],
        categorical_columns: ['group'],
        all_records: [
          { x: 1, y: 2, z: 3, group: 'A' },
          { x: 2, y: 3, z: 4, group: 'A' },
          { x: 3, y: 4, z: 5, group: 'B' },
          { x: 4, y: 5, z: 6, group: 'B' },
          { x: 5, y: 6, z: 7, group: 'C' },
          { x: 6, y: 7, z: 8, group: 'C' },
        ],
      },
      {
        columns: ['x', 'y', 'z'],
        categoricalColumns: ['group'],
        nComponents: 2,
        scale: true,
      }
    );

    assert.equal(preview.preprocessing.report.valid, true);
    assert.equal(preview.pcaPreview.nComponents, 2);
    assert.ok(Array.isArray(preview.pcaPreview.explainedVarianceRatio));
    assert.ok(preview.preprocessingDiff.summary.outputFeatureCount >= 3);
  });
});
