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
import app from '../src/index.js';

// ── Default welcome endpoint ──────────────────────────────────────────────────

describe('Server', () => {
  it('GET /welcome returns the default welcome message', async () => {
    const res = await request(app).get('/welcome');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.message, 'Welcome!');
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('Testing Register API', () => {
  // Positive case: valid username + password → 200 + "Success"
  it('positive : /register — valid input returns 200 and Success', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'testuser', password: 'password123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Success');
  });

  // Negative case: missing password / wrong type → 400 + "Invalid input"
  it('negative : /register — invalid input returns 400 and Invalid input', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 12345 }); // not a string, missing password
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Invalid input');
  });
});

// ── Redirect & render stubs ───────────────────────────────────────────────────

describe('Testing Redirect', () => {
  it('GET /test redirects to /login with 302', async () => {
    const res = await request(app).get('/test').redirects(0);
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.endsWith('/login'));
  });
});

describe('Testing Render', () => {
  it('GET /login responds with HTML and status 200', async () => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('html'));
  });
});

// ── Auth protection ───────────────────────────────────────────────────────────

describe('Auth-protected routes', () => {
  it('GET /api/datasets without a token returns 401', async () => {
    const res = await request(app).get('/api/datasets');
    assert.equal(res.status, 401);
  });

  it('POST /api/datasets/upload without a token returns 401', async () => {
    const res = await request(app).post('/api/datasets/upload');
    assert.equal(res.status, 401);
  });
});

// ── CSV upload validation (bad input, no auth needed for this path test) ──────

describe('Upload validation', () => {
  it('POST /api/datasets/upload with a valid token but no file returns 400', async () => {
    // Sign a fake token for test purposes
    // We import jwt here so NODE_ENV=test skips the DB but token verification
    // still works against the default dev secret.
    const { default: jwt } = await import('jsonwebtoken');
    const token = jwt.sign(
      { username: 'tester', userId: 999 },
      process.env.JWT_SECRET || 'dev-secret-change-in-production',
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/datasets/upload')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 400);
    assert.ok(res.body.message.toLowerCase().includes('no file'));
  });
});
