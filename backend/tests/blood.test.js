import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, authed, query, queryOne, closePool } from './helpers.js';

describe('Blood subsystem', () => {
  let requestId;

  test('TC-B01 availability search returns only unexpired, available stock', async () => {
    const res = await api().get('/api/blood/availability').set(await authed('admin'));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0, 'seeded data should expose stock');
    for (const row of res.body.data) {
      assert.ok(new Date(row.earliest_expiry) > new Date(), 'expired stock must not be offered');
      assert.ok(Number(row.available_units) > 0);
    }
  });

  test('TC-B02 availability search never exposes donor identity', async () => {
    const res = await api().get('/api/blood/availability').set(await authed('admin'));
    const keys = Object.keys(res.body.data[0]).join(' ').toLowerCase();
    for (const leak of ['donor_name', 'donor_id', 'email', 'address']) {
      assert.ok(!keys.includes(leak), `availability leaked ${leak}`);
    }
  });

  test('TC-B03 compatibility filter returns only groups compatible with the patient', async () => {
    // O- (id 2) is the universal donor but can receive only from O-.
    const res = await api()
      .get('/api/blood/availability?recipientBloodGroupId=2&componentId=2')
      .set(await authed('admin'));
    assert.equal(res.status, 200);
    for (const row of res.body.data) {
      assert.equal(row.blood_group, 'O-', 'an O- patient may only receive O- red cells');
    }
  });

  test('TC-B04 AB+ is the universal red cell recipient', async () => {
    const res = await api()
      .get('/api/blood/availability?recipientBloodGroupId=7&componentId=2')
      .set(await authed('admin'));
    const groups = new Set(res.body.data.map((r) => r.blood_group));
    assert.ok(groups.size > 1, 'AB+ should be offered several donor groups');
  });

  test('TC-B05 creating a request with invalid input returns 400 with field detail', async () => {
    const res = await api().post('/api/blood/requests').set(await authed('hospital'))
      .send({ bloodGroupId: 'x', componentId: 2, unitsRequired: 999, urgency: 'SOON' });
    assert.equal(res.status, 400);
    const fields = res.body.error.details.map((d) => d.field);
    assert.ok(fields.includes('unitsRequired'));
    assert.ok(fields.includes('urgency'));
  });

  test('TC-B06 a hospital can raise a request', async () => {
    const res = await api().post('/api/blood/requests').set(await authed('hospital'))
      .send({ bloodGroupId: 3, componentId: 2, unitsRequired: 2, urgency: 'URGENT',
              patientName: 'Automated Test Patient', requiredBy: '2026-12-31',
              notes: 'created by the automated test suite' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'PENDING');
    assert.equal(res.body.data.unitsAllocated, 0);
    assert.match(res.body.data.requestCode, /^BR-\d{8}-\d{4}$/);
    requestId = res.body.data.bloodRequestId;
  });

  test('TC-B07 match preview lists candidate units in allocation order', async () => {
    const res = await api().get(`/api/blood/requests/${requestId}/match`).set(await authed('hospital'));
    assert.equal(res.status, 200);
    const units = res.body.data.candidateUnits;
    assert.ok(units.length > 0);
    // exact group matches must come before non-exact ones
    const exactFlags = units.map((u) => Number(u.exact_group_match));
    const firstNonExact = exactFlags.indexOf(0);
    if (firstNonExact !== -1) {
      assert.ok(!exactFlags.slice(firstNonExact).includes(1),
        'exact blood group matches must be ordered first');
    }
  });

  test('TC-B08 allocation reserves units inside a transaction', async () => {
    const res = await api().post(`/api/blood/requests/${requestId}/allocate`).set(await authed('hospital'));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.allocated, 2);
    assert.equal(res.body.data.request.status, 'ALLOCATED');
    for (const allocation of res.body.data.request.allocations) {
      assert.equal(allocation.status, 'RESERVED');
    }
  });

  test('TC-B09 every allocated unit is genuinely compatible', async () => {
    const rows = await query(
      `SELECT fn_blood_compatible(bu.blood_group_id, br.blood_group_id, bu.component_id) AS ok
         FROM blood_allocations ba
         JOIN blood_units bu ON bu.blood_unit_id = ba.blood_unit_id
         JOIN blood_requests br ON br.blood_request_id = ba.blood_request_id`);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(Number(row.ok), 1, 'an incompatible unit was allocated');
  });

  test('TC-B10 no blood unit is ever allocated twice', async () => {
    const rows = await query(
      `SELECT blood_unit_id, COUNT(*) AS n FROM blood_allocations
        WHERE status <> 'CANCELLED' GROUP BY blood_unit_id HAVING COUNT(*) > 1`);
    assert.equal(rows.length, 0, 'a unit was allocated more than once');
  });

  test('TC-B11 re-allocating a fully allocated request adds nothing', async () => {
    const res = await api().post(`/api/blood/requests/${requestId}/allocate`).set(await authed('hospital'));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.allocated, 0);
  });

  test('TC-B12 a request for an impossible quantity allocates only what exists', async () => {
    const created = await api().post('/api/blood/requests').set(await authed('hospital'))
      .send({ bloodGroupId: 8, componentId: 3, unitsRequired: 40, urgency: 'CRITICAL',
              patientName: 'Shortfall Test', requiredBy: '2026-12-31' });
    const id = created.body.data.bloodRequestId;
    const res = await api().post(`/api/blood/requests/${id}/allocate`).set(await authed('hospital'));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.allocated < 40, 'must not invent stock that does not exist');
    await api().patch(`/api/blood/requests/${id}/status`).set(await authed('hospital'))
      .send({ status: 'CANCELLED' });
  });

  test('TC-B13 fulfilling a request drives units RESERVED → ISSUED → TRANSFUSED', async () => {
    const res = await api().patch(`/api/blood/requests/${requestId}/status`)
      .set(await authed('hospital')).send({ status: 'FULFILLED' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'FULFILLED');
    for (const allocation of res.body.data.allocations) {
      assert.equal(allocation.status, 'TRANSFUSED');
    }
    const units = await query(
      `SELECT bu.status FROM blood_units bu
         JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
        WHERE ba.blood_request_id = ?`, [requestId]);
    for (const unit of units) assert.equal(unit.status, 'TRANSFUSED');
  });

  test('TC-B14 an illegal workflow transition is refused with 409', async () => {
    const res = await api().patch(`/api/blood/requests/${requestId}/status`)
      .set(await authed('hospital')).send({ status: 'PENDING' });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /Cannot move a request from FULFILLED/);
  });

  test('TC-B15 cancelling a request returns its reserved units to stock', async () => {
    const created = await api().post('/api/blood/requests').set(await authed('hospital'))
      .send({ bloodGroupId: 3, componentId: 2, unitsRequired: 1, urgency: 'ROUTINE',
              patientName: 'Cancellation Test', requiredBy: '2026-12-31' });
    const id = created.body.data.bloodRequestId;
    const allocated = await api().post(`/api/blood/requests/${id}/allocate`).set(await authed('hospital'));
    const unitId = allocated.body.data.request.allocations[0]?.bloodUnitId;
    assert.ok(unitId, 'expected at least one unit to be reserved');

    await api().patch(`/api/blood/requests/${id}/status`)
      .set(await authed('hospital')).send({ status: 'CANCELLED' });

    const unit = await queryOne('SELECT status FROM blood_units WHERE blood_unit_id = ?', [unitId]);
    assert.equal(unit.status, 'AVAILABLE', 'a cancelled request must not strand stock');
  });

  test('TC-B16 the 90-day donation interval is enforced', async () => {
    const donor = await queryOne(
      `SELECT donor_id FROM donors
        WHERE last_donation_date IS NOT NULL
          AND DATEDIFF(CURDATE(), last_donation_date) < 90 LIMIT 1`);
    const res = await api().post('/api/blood/donations').set(await authed('bloodBank'))
      .send({ donorId: donor.donor_id, donationDate: new Date().toISOString().slice(0, 10), volumeMl: 450 });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /minimum interval/);
  });

  test('TC-B17 expired units are never offered for allocation', async () => {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM blood_units
        WHERE status = 'AVAILABLE' AND expiry_date <= CURDATE()`);
    assert.equal(Number(rows[0].n), 0,
      'housekeeping should have retired every past-dated available unit');
  });

  after(async () => { await closePool(); });
});
