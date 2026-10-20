import { pool, query, queryOne, withTransaction } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { recordAudit, nextRequestCode } from '../utils/audit.js';
import { getPagination, getSort } from '../utils/pagination.js';
import { BLOOD_REQUEST_TRANSITIONS, canTransition, ROLES } from '../config/constants.js';

/* ==========================================================================
 * AVAILABILITY  /  SEARCH
 * ======================================================================== */

/**
 * Blood availability search.  Delegates to sp_search_available_blood so the
 * aggregation runs in the database against idx_bu_search rather than pulling
 * every unit into Node and counting there.
 *
 * Donor identity is deliberately absent from the result: the public
 * availability view exposes stock levels, never who gave the blood.
 */
export async function searchAvailability(filters) {
  const [resultSets] = await pool.query(
    'CALL sp_search_available_blood(?, ?, ?, ?, ?)',
    [
      filters.recipientBloodGroupId ?? null,
      filters.componentId ?? null,
      filters.cityId ?? null,
      filters.bloodBankId ?? null,
      filters.minUnits ?? 1,
    ],
  );
  return resultSets[0] ?? [];
}

/** Network-wide totals per blood group, for the landing page and dashboards. */
export function getAvailabilitySummary() {
  return query(
    `SELECT blood_group AS bloodGroup, component_code AS componentCode, component,
            SUM(available_units) AS availableUnits,
            SUM(total_volume_ml) AS totalVolumeMl,
            MIN(earliest_expiry) AS earliestExpiry,
            SUM(expiring_within_7_days) AS expiringSoon
       FROM v_available_blood_summary
      GROUP BY blood_group, component_code, component
      ORDER BY availableUnits DESC`,
  );
}

export function getExpiringUnits(bloodBankId) {
  return query(
    `SELECT blood_unit_id AS bloodUnitId, unit_code AS unitCode, blood_group AS bloodGroup,
            component, volume_ml AS volumeMl, collection_date AS collectionDate,
            expiry_date AS expiryDate, days_to_expiry AS daysToExpiry, status,
            blood_bank_id AS bloodBankId, blood_bank AS bloodBank, city
       FROM v_expiring_blood_units
      WHERE (? IS NULL OR blood_bank_id = ?)
      ORDER BY days_to_expiry ASC`,
    [bloodBankId ?? null, bloodBankId ?? null],
  );
}

/* ==========================================================================
 * BLOOD UNITS (inventory)
 * ======================================================================== */

const UNIT_SORTS = {
  expiry: 'bu.expiry_date',
  collected: 'bu.collection_date',
  code: 'bu.unit_code',
  status: 'bu.status',
};

export async function listUnits(filters, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, UNIT_SORTS, 'bu.expiry_date');

  const where = [];
  const params = [];
  if (filters.bloodBankId)  { where.push('bu.blood_bank_id = ?');  params.push(filters.bloodBankId); }
  if (filters.bloodGroupId) { where.push('bu.blood_group_id = ?'); params.push(filters.bloodGroupId); }
  if (filters.componentId)  { where.push('bu.component_id = ?');   params.push(filters.componentId); }
  if (filters.status)       { where.push('bu.status = ?');         params.push(filters.status); }
  if (filters.search)       { where.push('bu.unit_code LIKE ?');   params.push(`%${filters.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT bu.blood_unit_id AS bloodUnitId, bu.unit_code AS unitCode, bu.donation_id AS donationId,
            bg.group_code AS bloodGroup, cmp.name AS component, cmp.code AS componentCode,
            bu.volume_ml AS volumeMl, bu.collection_date AS collectionDate, bu.expiry_date AS expiryDate,
            DATEDIFF(bu.expiry_date, CURDATE()) AS daysToExpiry, bu.status,
            bb.blood_bank_id AS bloodBankId, bb.name AS bloodBank, ci.name AS city
       FROM blood_units bu
       JOIN blood_banks bb ON bb.blood_bank_id = bu.blood_bank_id
       JOIN cities ci ON ci.city_id = bb.city_id
       JOIN blood_groups bg ON bg.blood_group_id = bu.blood_group_id
       JOIN blood_components cmp ON cmp.component_id = bu.component_id
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const countRow = await queryOne(
    `SELECT COUNT(*) AS total FROM blood_units bu ${whereSql}`, params,
  );
  return { rows, page, limit, total: countRow.total };
}

/**
 * Record a donation and separate it into component units, atomically.
 * The trigger trg_blood_donations_after_insert updates the donor's counters;
 * expiry dates are derived by trg_blood_units_before_insert.
 */
export async function recordDonation(input, actor) {
  if (!input.bloodBankId) {
    throw ApiError.badRequest(
      'A blood bank must be specified. Blood bank accounts are bound to their own bank automatically.',
    );
  }

  const donor = await queryOne(
    `SELECT d.donor_id, d.blood_group_id, d.eligibility_status, d.last_donation_date, u.full_name
       FROM donors d JOIN users u ON u.user_id = d.user_id WHERE d.donor_id = ?`,
    [input.donorId],
  );
  if (!donor) throw ApiError.notFound('Donor not found');
  if (donor.eligibility_status === 'INELIGIBLE') {
    throw ApiError.conflict('This donor is marked permanently ineligible to donate');
  }

  const intervalRow = await queryOne(
    `SELECT config_value AS days FROM matching_config WHERE config_key = 'blood_donation_interval_days'`,
  );
  const intervalDays = Number(intervalRow?.days ?? 90);

  if (donor.last_donation_date) {
    const daysSince = Math.floor(
      (new Date(input.donationDate) - new Date(donor.last_donation_date)) / 86_400_000,
    );
    if (daysSince < intervalDays) {
      throw ApiError.conflict(
        `Donor last donated ${daysSince} day(s) ago; the minimum interval is ${intervalDays} days`,
      );
    }
  }

  const donationId = await withTransaction(async (cx) => {
    const [result] = await cx.execute(
      `INSERT INTO blood_donations
         (donor_id, blood_bank_id, blood_group_id, donation_date, volume_ml, hemoglobin_gdl, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.donorId, input.bloodBankId, donor.blood_group_id, input.donationDate,
       input.volumeMl ?? 450, input.hemoglobinGdl ?? null, input.notes ?? null, actor.userId],
    );
    const newDonationId = result.insertId;

    // Separate into the requested components; units start QUARANTINED and are
    // released to AVAILABLE only when screening is marked PASSED.
    const components = input.components?.length ? input.components : [
      { componentId: 2, volumeMl: 280 },   // packed red cells
      { componentId: 4, volumeMl: 220 },   // fresh frozen plasma
    ];

    for (const component of components) {
      const [codeRow] = await cx.execute(
        'SELECT code FROM blood_components WHERE component_id = ?', [component.componentId],
      );
      if (!codeRow.length) throw ApiError.badRequest(`Unknown blood component ${component.componentId}`);

      await cx.execute(
        `INSERT INTO blood_units
           (unit_code, donation_id, blood_bank_id, blood_group_id, component_id,
            volume_ml, collection_date, expiry_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'QUARANTINED')`,
        [`BU-${String(newDonationId).padStart(4, '0')}-${codeRow[0].code}`,
         newDonationId, input.bloodBankId, donor.blood_group_id,
         component.componentId, component.volumeMl ?? 250, input.donationDate],
      );
    }
    return newDonationId;
  });

  await recordAudit({
    userId: actor.userId, action: 'DONATION_CREATED', entityName: 'blood_donations',
    entityId: donationId, description: `Donation recorded for ${donor.full_name}`,
  });

  return getDonation(donationId);
}

export async function getDonation(donationId) {
  const donation = await queryOne(
    `SELECT bd.donation_id AS donationId, bd.donation_date AS donationDate, bd.volume_ml AS volumeMl,
            bd.hemoglobin_gdl AS hemoglobinGdl, bd.screening_status AS screeningStatus,
            bd.screened_at AS screenedAt, bd.notes,
            bg.group_code AS bloodGroup, u.full_name AS donorName, d.donor_id AS donorId,
            bb.blood_bank_id AS bloodBankId, bb.name AS bloodBank, ci.name AS city
       FROM blood_donations bd
       JOIN donors d ON d.donor_id = bd.donor_id
       JOIN users u ON u.user_id = d.user_id
       JOIN blood_banks bb ON bb.blood_bank_id = bd.blood_bank_id
       JOIN cities ci ON ci.city_id = bb.city_id
       JOIN blood_groups bg ON bg.blood_group_id = bd.blood_group_id
      WHERE bd.donation_id = ?`,
    [donationId],
  );
  if (!donation) throw ApiError.notFound('Donation not found');

  donation.units = await query(
    `SELECT bu.blood_unit_id AS bloodUnitId, bu.unit_code AS unitCode, cmp.name AS component,
            bu.volume_ml AS volumeMl, bu.expiry_date AS expiryDate, bu.status
       FROM blood_units bu JOIN blood_components cmp ON cmp.component_id = bu.component_id
      WHERE bu.donation_id = ? ORDER BY cmp.component_id`,
    [donationId],
  );
  return donation;
}

export async function listDonations(filters, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (filters.donorId)     { where.push('bd.donor_id = ?');         params.push(filters.donorId); }
  if (filters.bloodBankId) { where.push('bd.blood_bank_id = ?');    params.push(filters.bloodBankId); }
  if (filters.screeningStatus) { where.push('bd.screening_status = ?'); params.push(filters.screeningStatus); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT bd.donation_id AS donationId, bd.donation_date AS donationDate, bd.volume_ml AS volumeMl,
            bd.screening_status AS screeningStatus, bg.group_code AS bloodGroup,
            u.full_name AS donorName, d.donor_id AS donorId,
            bb.name AS bloodBank, ci.name AS city,
            (SELECT COUNT(*) FROM blood_units bu WHERE bu.donation_id = bd.donation_id) AS unitsProduced
       FROM blood_donations bd
       JOIN donors d ON d.donor_id = bd.donor_id
       JOIN users u ON u.user_id = d.user_id
       JOIN blood_banks bb ON bb.blood_bank_id = bd.blood_bank_id
       JOIN cities ci ON ci.city_id = bb.city_id
       JOIN blood_groups bg ON bg.blood_group_id = bd.blood_group_id
       ${whereSql}
      ORDER BY bd.donation_date DESC, bd.donation_id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM blood_donations bd ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

/**
 * Mark screening PASSED or FAILED.  The consequences -- releasing units to
 * AVAILABLE, or discarding every unit from a reactive donation -- are applied
 * by trg_blood_donations_after_update, not here.
 */
export async function updateScreening(donationId, screeningStatus, actor) {
  const donation = await queryOne(
    'SELECT screening_status, blood_bank_id FROM blood_donations WHERE donation_id = ?', [donationId],
  );
  if (!donation) throw ApiError.notFound('Donation not found');
  if (donation.screening_status !== 'PENDING') {
    throw ApiError.conflict(`Screening has already been recorded as ${donation.screening_status}`);
  }
  if (actor.role === ROLES.BLOOD_BANK && actor.bloodBankId !== donation.blood_bank_id) {
    throw ApiError.forbidden('You can only screen donations collected at your own blood bank');
  }

  await query(
    'UPDATE blood_donations SET screening_status = ?, screened_at = NOW() WHERE donation_id = ?',
    [screeningStatus, donationId],
  );
  await recordAudit({
    userId: actor.userId, action: 'SCREENING_RECORDED', entityName: 'blood_donations',
    entityId: donationId, description: `Screening result: ${screeningStatus}`,
  });
  return getDonation(donationId);
}

/* ==========================================================================
 * BLOOD REQUESTS
 * ======================================================================== */

export async function createRequest(input, actor) {
  const requestCode = await nextRequestCode('BR', 'blood_requests', 'request_code');

  // A hospital account may only raise requests for itself.
  const hospitalId = actor.role === ROLES.HOSPITAL ? actor.hospitalId : input.hospitalId;
  if (!hospitalId) throw ApiError.badRequest('A hospital must be specified for the request');

  // A recipient account may only raise requests for itself.
  let recipientId = input.recipientId ?? null;
  if (actor.role === ROLES.RECIPIENT) recipientId = actor.recipientId;

  const hospital = await queryOne('SELECT status FROM hospitals WHERE hospital_id = ?', [hospitalId]);
  if (!hospital) throw ApiError.badRequest('The specified hospital does not exist');
  if (hospital.status !== 'ACTIVE') {
    throw ApiError.forbidden('Requests can only be raised for an ACTIVE hospital');
  }

  const result = await query(
    `INSERT INTO blood_requests
       (request_code, recipient_id, hospital_id, blood_group_id, component_id,
        units_required, urgency, patient_name, required_by, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestCode, recipientId, hospitalId, input.bloodGroupId, input.componentId,
     input.unitsRequired, input.urgency, input.patientName ?? null,
     input.requiredBy, input.notes ?? null, actor.userId],
  );

  await recordAudit({
    userId: actor.userId, action: 'BLOOD_REQUEST_CREATED', entityName: 'blood_requests',
    entityId: result.insertId, description: `${requestCode}: ${input.unitsRequired} unit(s), ${input.urgency}`,
  });

  return getRequest(result.insertId);
}

export async function getRequest(requestId) {
  const request = await queryOne(
    `SELECT br.blood_request_id AS bloodRequestId, br.request_code AS requestCode,
            br.units_required AS unitsRequired, br.units_allocated AS unitsAllocated,
            br.urgency, br.patient_name AS patientName, br.request_date AS requestDate,
            br.required_by AS requiredBy, br.status, br.notes,
            bg.blood_group_id AS bloodGroupId, bg.group_code AS bloodGroup,
            cmp.component_id AS componentId, cmp.name AS component, cmp.code AS componentCode,
            h.hospital_id AS hospitalId, h.name AS hospital,
            ci.name AS city, ci.region,
            r.recipient_id AS recipientId, ru.full_name AS recipientName,
            cu.full_name AS createdByName,
            fn_compatible_unit_count(br.blood_group_id, br.component_id) AS compatibleUnitsInNetwork
       FROM blood_requests br
       JOIN hospitals h ON h.hospital_id = br.hospital_id
       JOIN cities ci ON ci.city_id = h.city_id
       JOIN blood_groups bg ON bg.blood_group_id = br.blood_group_id
       JOIN blood_components cmp ON cmp.component_id = br.component_id
       LEFT JOIN recipients r ON r.recipient_id = br.recipient_id
       LEFT JOIN users ru ON ru.user_id = r.user_id
       LEFT JOIN users cu ON cu.user_id = br.created_by
      WHERE br.blood_request_id = ?`,
    [requestId],
  );
  if (!request) throw ApiError.notFound('Blood request not found');

  request.allocations = await query(
    `SELECT ba.allocation_id AS allocationId, ba.status, ba.allocated_at AS allocatedAt,
            bu.unit_code AS unitCode, bu.blood_unit_id AS bloodUnitId,
            bg.group_code AS unitBloodGroup, bu.expiry_date AS expiryDate,
            bb.name AS bloodBank, ci.name AS city, au.full_name AS allocatedByName
       FROM blood_allocations ba
       JOIN blood_units bu ON bu.blood_unit_id = ba.blood_unit_id
       JOIN blood_groups bg ON bg.blood_group_id = bu.blood_group_id
       JOIN blood_banks bb ON bb.blood_bank_id = bu.blood_bank_id
       JOIN cities ci ON ci.city_id = bb.city_id
       LEFT JOIN users au ON au.user_id = ba.allocated_by
      WHERE ba.blood_request_id = ?
      ORDER BY ba.allocated_at`,
    [requestId],
  );
  return request;
}

const REQUEST_SORTS = {
  date: 'br.request_date', urgency: "FIELD(br.urgency,'ROUTINE','URGENT','CRITICAL')",
  required: 'br.required_by', status: 'br.status', code: 'br.request_code',
};

export async function listRequests(filters, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, REQUEST_SORTS, 'br.request_date');

  const where = [];
  const params = [];
  if (filters.hospitalId)   { where.push('br.hospital_id = ?');    params.push(filters.hospitalId); }
  if (filters.recipientId)  { where.push('br.recipient_id = ?');   params.push(filters.recipientId); }
  if (filters.status)       { where.push('br.status = ?');         params.push(filters.status); }
  if (filters.urgency)      { where.push('br.urgency = ?');        params.push(filters.urgency); }
  if (filters.bloodGroupId) { where.push('br.blood_group_id = ?'); params.push(filters.bloodGroupId); }
  if (filters.search)       { where.push('(br.request_code LIKE ? OR br.patient_name LIKE ?)');
                              params.push(`%${filters.search}%`, `%${filters.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT br.blood_request_id AS bloodRequestId, br.request_code AS requestCode,
            br.units_required AS unitsRequired, br.units_allocated AS unitsAllocated,
            br.urgency, br.patient_name AS patientName, br.request_date AS requestDate,
            br.required_by AS requiredBy, br.status,
            bg.group_code AS bloodGroup, cmp.name AS component,
            h.name AS hospital, h.hospital_id AS hospitalId, ci.name AS city
       FROM blood_requests br
       JOIN hospitals h ON h.hospital_id = br.hospital_id
       JOIN cities ci ON ci.city_id = h.city_id
       JOIN blood_groups bg ON bg.blood_group_id = br.blood_group_id
       JOIN blood_components cmp ON cmp.component_id = br.component_id
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM blood_requests br ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

/** Preview the units the allocator would take, without taking them. */
export async function previewMatches(requestId) {
  await getRequest(requestId);   // 404s if the request does not exist
  const [resultSets] = await pool.query('CALL sp_get_compatible_blood_units(?)', [requestId]);
  const units = resultSets[0] ?? [];
  return {
    candidateUnits: units,
    note: 'Ordering: exact blood group first, then same city as the requesting hospital, then first-expiring-first-out.',
  };
}

/**
 * Allocate units to a request.  All the work happens inside
 * sp_allocate_blood_request, which runs as a single transaction with row-level
 * locking -- see backend/sql/procedures.sql.
 */
export async function allocate(requestId, actor) {
  const request = await queryOne(
    'SELECT status, hospital_id FROM blood_requests WHERE blood_request_id = ?', [requestId],
  );
  if (!request) throw ApiError.notFound('Blood request not found');
  if (actor.role === ROLES.HOSPITAL && actor.hospitalId !== request.hospital_id) {
    throw ApiError.forbidden('You can only allocate against your own hospital\'s requests');
  }

  const connection = await pool.getConnection();
  try {
    await connection.query('CALL sp_allocate_blood_request(?, ?, @allocated, @message)', [requestId, actor.userId]);
    const [[outputs]] = await connection.query('SELECT @allocated AS allocated, @message AS message');
    const detail = await getRequest(requestId);
    return { allocated: Number(outputs.allocated ?? 0), message: outputs.message, request: detail };
  } finally {
    connection.release();
  }
}

/**
 * Move a request to a new status, validating the transition against
 * BLOOD_REQUEST_TRANSITIONS.  FULFILLED additionally walks the reserved units
 * through ISSUED -> TRANSFUSED, which the unit-level trigger validates.
 */
export async function updateRequestStatus(requestId, newStatus, actor) {
  const request = await queryOne(
    'SELECT status, hospital_id, units_allocated FROM blood_requests WHERE blood_request_id = ?', [requestId],
  );
  if (!request) throw ApiError.notFound('Blood request not found');

  if (actor.role === ROLES.HOSPITAL && actor.hospitalId !== request.hospital_id) {
    throw ApiError.forbidden('You can only update your own hospital\'s requests');
  }
  if (!canTransition(BLOOD_REQUEST_TRANSITIONS, request.status, newStatus)) {
    throw ApiError.conflict(
      `Cannot move a request from ${request.status} to ${newStatus}. ` +
      `Allowed next states: ${BLOOD_REQUEST_TRANSITIONS[request.status]?.join(', ') || 'none (terminal state)'}.`,
    );
  }

  await withTransaction(async (cx) => {
    if (newStatus === 'FULFILLED') {
      if (request.units_allocated < 1) {
        throw ApiError.conflict('A request with no allocated units cannot be fulfilled');
      }
      // RESERVED -> ISSUED -> TRANSFUSED, one step at a time so the unit
      // lifecycle trigger accepts each move.
      await cx.execute(
        `UPDATE blood_units bu JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
            SET bu.status = 'ISSUED'
          WHERE ba.blood_request_id = ? AND ba.status = 'RESERVED' AND bu.status = 'RESERVED'`,
        [requestId],
      );
      await cx.execute(
        `UPDATE blood_units bu JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
            SET bu.status = 'TRANSFUSED'
          WHERE ba.blood_request_id = ? AND ba.status = 'RESERVED' AND bu.status = 'ISSUED'`,
        [requestId],
      );
      await cx.execute(
        `UPDATE blood_allocations SET status = 'TRANSFUSED' WHERE blood_request_id = ? AND status = 'RESERVED'`,
        [requestId],
      );
    }

    if (newStatus === 'CANCELLED' || newStatus === 'REJECTED') {
      // Return any reserved stock to the shelf so it is not stranded.
      await cx.execute(
        `UPDATE blood_units bu JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
            SET bu.status = 'AVAILABLE'
          WHERE ba.blood_request_id = ? AND ba.status = 'RESERVED' AND bu.status = 'RESERVED'`,
        [requestId],
      );
      await cx.execute(
        `UPDATE blood_allocations SET status = 'CANCELLED' WHERE blood_request_id = ? AND status = 'RESERVED'`,
        [requestId],
      );
      await cx.execute(
        'UPDATE blood_requests SET units_allocated = 0 WHERE blood_request_id = ?', [requestId],
      );
    }

    await cx.execute('UPDATE blood_requests SET status = ? WHERE blood_request_id = ?', [newStatus, requestId]);
  });

  await recordAudit({
    userId: actor.userId, action: 'BLOOD_REQUEST_STATUS_SET', entityName: 'blood_requests',
    entityId: requestId, description: `${request.status} -> ${newStatus}`,
  });
  return getRequest(requestId);
}

/** Housekeeping: expire stale units, organs and requests. */
export async function runExpiry(actor) {
  const connection = await pool.getConnection();
  try {
    await connection.query('CALL sp_expire_stale_records(@u, @o, @r, @d)');
    const [[out]] = await connection.query(
      'SELECT @u AS unitsExpired, @o AS organsExpired, @r AS requestsExpired, @d AS donorsReinstated');
    await recordAudit({
      userId: actor.userId, action: 'HOUSEKEEPING_RUN', entityName: 'system',
      description: `Expired ${out.unitsExpired} units, ${out.organsExpired} organs, `
        + `${out.requestsExpired} requests; ${out.donorsReinstated} donors reinstated`,
    });
    return out;
  } finally {
    connection.release();
  }
}
