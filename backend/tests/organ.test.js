import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, authed, query, queryOne, closePool } from './helpers.js';

describe('Organ subsystem', () => {
  let organRequestId;

  test('TC-O01 organ availability exposes no donor identity', async () => {
    const res = await api().get('/api/organs/availability').set(await authed('transplant'));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    const keys = Object.keys(res.body.data[0]).map((k) => k.toLowerCase());
    for (const leak of ['donorname', 'email', 'address', 'userid', 'organdonorid']) {
      assert.ok(!keys.includes(leak), `organ availability leaked ${leak}`);
    }
  });

  test('TC-O02 only viable, in-window organs are listed', async () => {
    const res = await api().get('/api/organs/availability').set(await authed('transplant'));
    for (const organ of res.body.data) {
      assert.equal(organ.availabilityStatus, 'AVAILABLE');
      assert.ok(new Date(organ.viableUntil) > new Date(), 'an out-of-window organ was listed');
    }
  });

  test('TC-O03 a donor can record an organ pledge', async () => {
    const res = await api().post('/api/organs/donors/me').set(await authed('donor'))
      .send({ donorKind: 'LIVING', consentStatus: 'CONSENTED',
              nextOfKin: 'Test Kin', organTypeIds: [1, 6] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.consentStatus, 'CONSENTED');
    assert.equal(res.body.data.pledges.length, 2);
  });

  test('TC-O04 an invalid organ request is rejected with 400', async () => {
    const res = await api().post('/api/organ-requests').set(await authed('hospital'))
      .send({ organTypeId: 1, urgency: 'CRITICAL', medicalPriority: 500 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.field === 'medicalPriority'));
  });

  test('TC-O05 a hospital can raise an organ request', async () => {
    const res = await api().post('/api/organ-requests').set(await authed('hospital'))
      .send({ recipientId: 1, organTypeId: 1, urgency: 'CRITICAL',
              medicalPriority: 90, notes: 'automated test' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'PENDING');
    organRequestId = res.body.data.organRequestId;
  });

  test('TC-O06 matching scores candidates and records the breakdown', async () => {
    const res = await api().post(`/api/organ-requests/${organRequestId}/match`)
      .set(await authed('hospital'));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.matchCount > 0, 'expected candidate kidneys in the seed data');
    assert.match(res.body.data.disclaimer, /academic simulation/i);

    for (const match of res.body.data.request.matches) {
      assert.ok(Number(match.compatibilityScore) >= 0 && Number(match.compatibilityScore) <= 100);
      assert.ok(match.matchReason.length > 0);
    }
  });

  test('TC-O07 the stored score equals the weighted sum of its components', async () => {
    const rows = await query(
      `SELECT compatibility_score AS total, blood_score, urgency_score,
              priority_score, location_score, age_score
         FROM organ_matches WHERE organ_request_id = ?`, [organRequestId]);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const recomputed = (40 * row.blood_score + 25 * row.urgency_score
        + 20 * row.priority_score + 10 * row.location_score + 5 * row.age_score) / 100;
      assert.ok(Math.abs(Number(row.total) - recomputed) < 0.02,
        `score ${row.total} does not match its components (${recomputed})`);
    }
  });

  test('TC-O08 only blood-compatible organs are proposed', async () => {
    const rows = await query(
      `SELECT bc.is_compatible AS ok
         FROM organ_matches om
         JOIN available_organs ao ON ao.organ_id = om.organ_id
         JOIN organ_requests orq ON orq.organ_request_id = om.organ_request_id
         JOIN blood_compatibility bc
           ON bc.donor_group_id = ao.blood_group_id
          AND bc.recipient_group_id = orq.blood_group_id
          AND bc.component_id = (SELECT component_id FROM blood_components WHERE code='WHOLE_BLOOD')
        WHERE om.organ_request_id = ?`, [organRequestId]);
    for (const row of rows) assert.equal(Number(row.ok), 1, 'an incompatible organ was proposed');
  });

  test('TC-O09 matches are ranked highest score first', async () => {
    const res = await api().get(`/api/organ-requests/${organRequestId}/matches`)
      .set(await authed('hospital'));
    const scores = res.body.data.matches.map((m) => Number(m.compatibilityScore));
    const sorted = [...scores].sort((a, b) => b - a);
    assert.deepEqual(scores, sorted);
  });

  test('TC-O10 PROPOSED cannot jump straight to ALLOCATED', async () => {
    const matches = await api().get(`/api/organ-requests/${organRequestId}/matches`)
      .set(await authed('hospital'));
    const proposed = matches.body.data.matches.find((m) => m.matchStatus === 'PROPOSED');
    const res = await api().patch(`/api/organ-requests/matches/${proposed.matchId}/status`)
      .set(await authed('transplant')).send({ status: 'ALLOCATED' });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /ACCEPTED/);
  });

  test('TC-O11 ACCEPTED → ALLOCATED reserves the organ and cancels rival proposals', async () => {
    const matches = await api().get(`/api/organ-requests/${organRequestId}/matches`)
      .set(await authed('hospital'));
    const target = matches.body.data.matches.find((m) => m.matchStatus === 'PROPOSED');

    const accepted = await api().patch(`/api/organ-requests/matches/${target.matchId}/status`)
      .set(await authed('transplant')).send({ status: 'ACCEPTED' });
    assert.equal(accepted.status, 200);

    const allocated = await api().patch(`/api/organ-requests/matches/${target.matchId}/status`)
      .set(await authed('transplant')).send({ status: 'ALLOCATED' });
    assert.equal(allocated.status, 200);
    assert.equal(allocated.body.data.status, 'ALLOCATED');

    const organ = await queryOne(
      'SELECT availability_status FROM available_organs WHERE organ_id = ?', [target.organId]);
    assert.equal(organ.availability_status, 'ALLOCATED');

    const rivals = await query(
      `SELECT status FROM organ_matches WHERE organ_id = ? AND match_id <> ?`,
      [target.organId, target.matchId]);
    for (const rival of rivals) {
      assert.notEqual(rival.status, 'PROPOSED', 'a rival proposal for the same organ stayed open');
    }
  });

  test('TC-O12 an organ cannot be allocated to two requests', async () => {
    const rows = await query(
      `SELECT organ_id, COUNT(*) AS n FROM organ_matches
        WHERE status IN ('ALLOCATED','COMPLETED')
        GROUP BY organ_id HAVING COUNT(*) > 1`);
    assert.equal(rows.length, 0, 'an organ was allocated more than once');
  });

  after(async () => { await closePool(); });
});
