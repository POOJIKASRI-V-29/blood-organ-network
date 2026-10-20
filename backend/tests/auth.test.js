import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, authed, CREDENTIALS, closePool } from './helpers.js';

describe('Authentication', () => {
  test('TC-A01 valid login returns a token and the user, never the password hash', async () => {
    const res = await api().post('/api/auth/login').send(CREDENTIALS.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.token.length > 20);
    assert.equal(res.body.data.user.role, 'ADMIN');
    assert.equal(res.body.data.user.password_hash, undefined);
    assert.equal(res.body.data.user.passwordHash, undefined);
  });

  test('TC-A02 wrong password is rejected with 401', async () => {
    const res = await api().post('/api/auth/login')
      .send({ email: CREDENTIALS.admin.email, password: 'definitely-wrong' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('TC-A03 unknown email returns the same message as a wrong password (no account enumeration)', async () => {
    const unknown = await api().post('/api/auth/login')
      .send({ email: 'nobody@nowhere.test', password: 'whatever1!' });
    const wrongPassword = await api().post('/api/auth/login')
      .send({ email: CREDENTIALS.admin.email, password: 'definitely-wrong' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, wrongPassword.body.error.message);
  });

  test('TC-A04 duplicate email is rejected with 409', async () => {
    const res = await api().post('/api/auth/register').send({
      role: 'DONOR', fullName: 'Duplicate Person', email: CREDENTIALS.donor.email,
      password: 'Password@123', dateOfBirth: '1995-01-01', gender: 'MALE',
      bloodGroupId: 1, cityId: 1,
    });
    assert.equal(res.status, 409);
  });

  test('TC-A05 weak password is rejected with field-level detail', async () => {
    const res = await api().post('/api/auth/register').send({
      role: 'DONOR', fullName: 'Weak Password', email: `weak${Date.now()}@test.local`,
      password: 'abc', dateOfBirth: '1995-01-01', gender: 'MALE', bloodGroupId: 1, cityId: 1,
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.field === 'password'));
  });

  test('TC-A06 an ADMIN account cannot be self-registered', async () => {
    const res = await api().post('/api/auth/register').send({
      role: 'ADMIN', fullName: 'Sneaky Admin', email: `admin${Date.now()}@test.local`,
      password: 'Password@123',
    });
    assert.ok([400, 403].includes(res.status));
  });

  test('TC-A07 a protected route without a token returns 401', async () => {
    const res = await api().get('/api/users');
    assert.equal(res.status, 401);
  });

  test('TC-A08 a malformed token returns 401', async () => {
    const res = await api().get('/api/users').set('Authorization', 'Bearer not.a.jwt');
    assert.equal(res.status, 401);
  });

  test('TC-A09 /auth/me returns the joined role profile', async () => {
    const res = await api().get('/api/auth/me').set(await authed('donor'));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.role, 'DONOR');
    assert.ok(res.body.data.profile.bloodGroup);
    assert.ok(Number.isInteger(res.body.data.profile.donorId));
  });

  test('TC-A10 registering a blood bank creates it PENDING, not ACTIVE', async () => {
    const stamp = Date.now();
    const res = await api().post('/api/auth/register').send({
      role: 'BLOOD_BANK', fullName: 'Test Contact', email: `bank${stamp}@test.local`,
      password: 'Password@123', organisationName: `Test Bank ${stamp}`,
      registrationNumber: `BB-TEST-${stamp}`, address: '1 Test Road', cityId: 1,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.status, 'PENDING');
  });

  after(async () => { await closePool(); });
});
