import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, authed, closePool } from './helpers.js';

describe('Role-based authorization', () => {
  test('TC-Z01 ADMIN may list users', async () => {
    const res = await api().get('/api/users?limit=5').set(await authed('admin'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  test('TC-Z02 DONOR may not list users', async () => {
    const res = await api().get('/api/users').set(await authed('donor'));
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /ADMIN/);
  });

  test('TC-Z03 DONOR may not record a donation', async () => {
    const res = await api().post('/api/blood/donations').set(await authed('donor'))
      .send({ donorId: 1, bloodBankId: 1, donationDate: '2026-09-15' });
    assert.equal(res.status, 403);
  });

  test('TC-Z04 DONOR may not view the audit log', async () => {
    const res = await api().get('/api/audit-logs').set(await authed('donor'));
    assert.equal(res.status, 403);
  });

  test('TC-Z05 RECIPIENT may not manage the organ registry', async () => {
    const res = await api().post('/api/organs').set(await authed('recipient'))
      .send({ organDonorId: 1, organTypeId: 1, bloodGroupId: 1, donorAge: 40,
              recoveredAt: '2026-09-15 10:00:00' });
    assert.equal(res.status, 403);
  });

  test('TC-Z06 BLOOD_BANK may not raise a blood request', async () => {
    const res = await api().post('/api/blood/requests').set(await authed('bloodBank'))
      .send({ hospitalId: 1, bloodGroupId: 1, componentId: 2, unitsRequired: 1,
              urgency: 'ROUTINE', requiredBy: '2026-12-31' });
    assert.equal(res.status, 403);
  });

  test('TC-Z07 HOSPITAL may not view blood bank inventory expiry list', async () => {
    const res = await api().get('/api/blood/expiring').set(await authed('hospital'));
    assert.equal(res.status, 403);
  });

  test('TC-Z08 a DONOR sees only their own donations (row-level scoping)', async () => {
    const res = await api().get('/api/blood/donations?limit=50').set(await authed('donor'));
    assert.equal(res.status, 200);
    const me = await api().get('/api/auth/me').set(await authed('donor'));
    const myDonorId = me.body.data.profile.donorId;
    for (const row of res.body.data) {
      assert.equal(row.donorId, myDonorId, 'a donor must not see another donor\'s donations');
    }
  });

  test('TC-Z09 a HOSPITAL sees only its own blood requests', async () => {
    const res = await api().get('/api/blood/requests?limit=50').set(await authed('hospital'));
    const me = await api().get('/api/auth/me').set(await authed('hospital'));
    const myHospitalId = me.body.data.profile.hospitalId;
    assert.equal(res.status, 200);
    for (const row of res.body.data) {
      assert.equal(row.hospitalId, myHospitalId);
    }
  });

  test('TC-Z10 only ADMIN may run housekeeping', async () => {
    const denied = await api().post('/api/blood/housekeeping/expire').set(await authed('hospital'));
    assert.equal(denied.status, 403);
    const allowed = await api().post('/api/blood/housekeeping/expire').set(await authed('admin'));
    assert.equal(allowed.status, 200);
  });

  after(async () => { await closePool(); });
});
