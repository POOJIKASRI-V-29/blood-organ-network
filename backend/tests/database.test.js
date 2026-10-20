import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne, closePool } from './helpers.js';
import { pool, withTransaction } from '../src/config/db.js';

/** Assert that a query fails, and return the MySQL error. */
async function expectFailure(sql, params = []) {
  try {
    await query(sql, params);
    assert.fail('expected the database to reject this statement');
  } catch (error) {
    return error;
  }
}

describe('Database constraints, triggers and transactions', () => {
  test('TC-D01 a foreign key violation is rejected', async () => {
    const error = await expectFailure(
      `INSERT INTO blood_units (unit_code, blood_bank_id, blood_group_id, component_id,
                                volume_ml, collection_date, expiry_date, status)
       VALUES ('FK-TEST-1', 9999, 1, 2, 280, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'AVAILABLE')`);
    assert.match(error.code, /ER_NO_REFERENCED_ROW/);
  });

  test('TC-D02 a unique constraint is enforced (users.email)', async () => {
    const error = await expectFailure(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Clash', 'admin@bon.health', 'x', 'DONOR')`);
    assert.equal(error.code, 'ER_DUP_ENTRY');
  });

  test('TC-D03 a CHECK constraint is enforced (units_required <= 50)', async () => {
    const error = await expectFailure(
      `INSERT INTO blood_requests (request_code, hospital_id, blood_group_id, component_id,
                                   units_required, required_by)
       VALUES ('CHK-TEST-1', 1, 1, 2, 999, CURDATE())`);
    assert.match(error.message, /chk_br_units|Check constraint/i);
  });

  test('TC-D04 NOT NULL is enforced', async () => {
    const error = await expectFailure(
      `INSERT INTO cities (name, state, region) VALUES (NULL, 'X', 'South')`);
    assert.ok(['ER_BAD_NULL_ERROR', 'ER_NO_DEFAULT_FOR_FIELD'].includes(error.code));
  });

  test('TC-D05 TRIGGER 1 derives expiry_date from the component shelf life', async () => {
    const code = `TRG-EXP-${Date.now()}`;
    await query(
      `INSERT INTO blood_units (unit_code, blood_bank_id, blood_group_id, component_id,
                                volume_ml, collection_date, expiry_date, status)
       VALUES (?, 1, 1, 3, 60, CURDATE(), NULL, 'QUARANTINED')`, [code]);   // component 3 = platelets, 5 days
    const unit = await queryOne(
      'SELECT DATEDIFF(expiry_date, collection_date) AS days FROM blood_units WHERE unit_code = ?', [code]);
    assert.equal(Number(unit.days), 5, 'platelet shelf life should be 5 days');
    await query('DELETE FROM blood_units WHERE unit_code = ?', [code]);
  });

  test('TC-D06 TRIGGER 2 refuses an illegal unit status transition', async () => {
    const code = `TRG-FSM-${Date.now()}`;
    await query(
      `INSERT INTO blood_units (unit_code, blood_bank_id, blood_group_id, component_id,
                                volume_ml, collection_date, expiry_date, status)
       VALUES (?, 1, 1, 2, 280, CURDATE(), NULL, 'AVAILABLE')`, [code]);
    const unit = await queryOne('SELECT blood_unit_id FROM blood_units WHERE unit_code = ?', [code]);

    // AVAILABLE -> TRANSFUSED skips RESERVED and ISSUED, and must be refused.
    const error = await expectFailure(
      `UPDATE blood_units SET status = 'TRANSFUSED' WHERE blood_unit_id = ?`, [unit.blood_unit_id]);
    assert.match(error.message, /Illegal blood unit status transition/);

    await query('DELETE FROM blood_units WHERE unit_code = ?', [code]);
  });

  test('TC-D07 TRIGGER 4 prevents allocating a unit that is not AVAILABLE', async () => {
    const reserved = await queryOne(
      `SELECT blood_unit_id FROM blood_units WHERE status IN ('RESERVED','TRANSFUSED','EXPIRED') LIMIT 1`);
    const request = await queryOne(
      `SELECT blood_request_id FROM blood_requests WHERE status = 'PENDING' LIMIT 1`);
    if (!reserved || !request) return;   // nothing suitable in the current data

    const error = await expectFailure(
      `INSERT INTO blood_allocations (blood_request_id, blood_unit_id, status)
       VALUES (?, ?, 'RESERVED')`, [request.blood_request_id, reserved.blood_unit_id]);
    assert.match(error.message, /not AVAILABLE|has expired/);
  });

  test('TC-D08 TRIGGER 5 maintains donors.total_donations', async () => {
    const rows = await query(
      `SELECT d.donor_id, d.total_donations,
              (SELECT COUNT(*) FROM blood_donations bd WHERE bd.donor_id = d.donor_id) AS actual
         FROM donors d`);
    for (const row of rows) {
      assert.equal(Number(row.total_donations), Number(row.actual),
        `donor ${row.donor_id}: cached total drifted from the donation rows`);
    }
  });

  test('TC-D09 TRIGGER 6 discards every unit when screening fails', async () => {
    const rows = await query(
      `SELECT bu.status FROM blood_units bu
         JOIN blood_donations bd ON bd.donation_id = bu.donation_id
        WHERE bd.screening_status = 'FAILED'`);
    assert.ok(rows.length > 0, 'the seed contains failed screenings');
    for (const row of rows) {
      assert.equal(row.status, 'DISCARDED', 'a unit from a failed donation was not discarded');
    }
  });

  test('TC-D10 triggers write audit rows with source = TRIGGER', async () => {
    const row = await queryOne(
      `SELECT COUNT(*) AS n FROM audit_logs WHERE source = 'TRIGGER'`);
    assert.ok(Number(row.n) > 0, 'no trigger-written audit entries found');
  });

  test('TC-D11 a transaction rolls back cleanly on error', async () => {
    const before = await queryOne('SELECT COUNT(*) AS n FROM cities');

    await assert.rejects(withTransaction(async (cx) => {
      await cx.execute(`INSERT INTO cities (name, state, region) VALUES ('Rollback City','Test','South')`);
      throw new Error('deliberate failure inside the transaction');
    }));

    const after = await queryOne('SELECT COUNT(*) AS n FROM cities');
    assert.equal(Number(after.n), Number(before.n), 'the rolled-back insert persisted');
  });

  test('TC-D12 a committed transaction persists', async () => {
    const name = `Commit City ${Date.now()}`;
    await withTransaction(async (cx) => {
      await cx.execute(`INSERT INTO cities (name, state, region) VALUES (?, 'Test', 'South')`, [name]);
    });
    const row = await queryOne('SELECT city_id FROM cities WHERE name = ?', [name]);
    assert.ok(row, 'the committed insert was lost');
    await query('DELETE FROM cities WHERE name = ?', [name]);
  });

  test('TC-D13 the compatibility matrix is complete and correct', async () => {
    const total = await queryOne('SELECT COUNT(*) AS n FROM blood_compatibility');
    assert.equal(Number(total.n), 8 * 8 * 5, 'expected a full 8 x 8 x 5 matrix');

    // O- is the universal red cell donor: compatible with all 8 recipient groups.
    const universal = await queryOne(
      `SELECT SUM(bc.is_compatible) AS n FROM blood_compatibility bc
         JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
        WHERE d.group_code = 'O-' AND bc.component_id = 2`);
    assert.equal(Number(universal.n), 8);

    // AB+ red cells serve only AB+.
    const restricted = await queryOne(
      `SELECT SUM(bc.is_compatible) AS n FROM blood_compatibility bc
         JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
        WHERE d.group_code = 'AB+' AND bc.component_id = 2`);
    assert.equal(Number(restricted.n), 1);

    // Plasma reverses the rule: AB plasma serves everyone.
    const plasma = await queryOne(
      `SELECT SUM(bc.is_compatible) AS n FROM blood_compatibility bc
         JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
        WHERE d.group_code = 'AB+' AND bc.component_id = 4`);
    assert.equal(Number(plasma.n), 8);
  });

  test('TC-D14 referential integrity: no orphaned rows anywhere', async () => {
    const orphans = await query(`
      SELECT 'blood_units.blood_bank_id' AS ref, COUNT(*) AS n FROM blood_units bu
        LEFT JOIN blood_banks bb ON bb.blood_bank_id = bu.blood_bank_id WHERE bb.blood_bank_id IS NULL
      UNION ALL
      SELECT 'blood_allocations.blood_unit_id', COUNT(*) FROM blood_allocations ba
        LEFT JOIN blood_units bu ON bu.blood_unit_id = ba.blood_unit_id WHERE bu.blood_unit_id IS NULL
      UNION ALL
      SELECT 'organ_matches.organ_id', COUNT(*) FROM organ_matches om
        LEFT JOIN available_organs ao ON ao.organ_id = om.organ_id WHERE ao.organ_id IS NULL
      UNION ALL
      SELECT 'donors.user_id', COUNT(*) FROM donors d
        LEFT JOIN users u ON u.user_id = d.user_id WHERE u.user_id IS NULL`);
    for (const row of orphans) assert.equal(Number(row.n), 0, `orphaned rows via ${row.ref}`);
  });

  test('TC-D15 all database objects exist', async () => {
    const counts = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema='blood_organ_network' AND table_type='BASE TABLE') AS tables_n,
        (SELECT COUNT(*) FROM information_schema.views
          WHERE table_schema='blood_organ_network') AS views_n,
        (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_schema='blood_organ_network' AND routine_type='PROCEDURE') AS procs,
        (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_schema='blood_organ_network' AND routine_type='FUNCTION') AS funcs,
        (SELECT COUNT(*) FROM information_schema.triggers
          WHERE trigger_schema='blood_organ_network') AS triggers_n,
        (SELECT COUNT(*) FROM information_schema.referential_constraints
          WHERE constraint_schema='blood_organ_network') AS fks`);
    assert.equal(Number(counts.tables_n), 23);
    assert.equal(Number(counts.views_n), 8);
    assert.equal(Number(counts.procs), 6);
    assert.equal(Number(counts.funcs), 3);
    assert.equal(Number(counts.triggers_n), 10);
    assert.equal(Number(counts.fks), 50);
  });

  after(async () => { await closePool(); });
});
