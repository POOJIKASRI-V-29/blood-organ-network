import { pool, query, queryOne, withTransaction } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { recordAudit, nextRequestCode } from '../utils/audit.js';
import { getPagination, getSort } from '../utils/pagination.js';
import {
  ORGAN_REQUEST_TRANSITIONS, ORGAN_MATCH_TRANSITIONS, canTransition, ROLES,
} from '../config/constants.js';

/* ==========================================================================
 * ORGAN DONOR REGISTRATION
 * ======================================================================== */

/** Register the signed-in donor as an organ donor and record their pledges. */
export async function registerOrganDonor(input, actor) {
  if (!actor.donorId) throw ApiError.forbidden('Only a donor profile can register organ donation preferences');

  const existing = await queryOne(
    'SELECT organ_donor_id FROM organ_donors WHERE donor_id = ?', [actor.donorId],
  );

  const organDonorId = await withTransaction(async (cx) => {
    let id = existing?.organ_donor_id;
    if (id) {
      await cx.execute(
        `UPDATE organ_donors SET consent_status = ?, donor_kind = ?, next_of_kin = ?, notes = ?
          WHERE organ_donor_id = ?`,
        [input.consentStatus, input.donorKind, input.nextOfKin ?? null, input.notes ?? null, id],
      );
    } else {
      const [result] = await cx.execute(
        `INSERT INTO organ_donors (donor_id, registration_date, donor_kind, consent_status, next_of_kin, notes)
         VALUES (?, CURDATE(), ?, ?, ?, ?)`,
        [actor.donorId, input.donorKind, input.consentStatus, input.nextOfKin ?? null, input.notes ?? null],
      );
      id = result.insertId;
    }

    // Replace the pledge set with the submitted one.
    await cx.execute('UPDATE organ_donor_pledges SET status = ? WHERE organ_donor_id = ?', ['WITHDRAWN', id]);
    for (const organTypeId of input.organTypeIds ?? []) {
      await cx.execute(
        `INSERT INTO organ_donor_pledges (organ_donor_id, organ_type_id, pledged_at, status)
         VALUES (?, ?, CURDATE(), 'ACTIVE')
         ON DUPLICATE KEY UPDATE status = 'ACTIVE', pledged_at = CURDATE()`,
        [id, organTypeId],
      );
    }
    return id;
  });

  await recordAudit({
    userId: actor.userId, action: 'ORGAN_DONOR_REGISTERED', entityName: 'organ_donors',
    entityId: organDonorId, description: `Consent: ${input.consentStatus}, ${input.organTypeIds?.length ?? 0} pledge(s)`,
  });
  return getOrganDonorByDonorId(actor.donorId);
}

export async function getOrganDonorByDonorId(donorId) {
  const record = await queryOne(
    `SELECT od.organ_donor_id AS organDonorId, od.registration_date AS registrationDate,
            od.donor_kind AS donorKind, od.consent_status AS consentStatus,
            od.medical_status AS medicalStatus, od.next_of_kin AS nextOfKin, od.notes,
            u.full_name AS donorName, bg.group_code AS bloodGroup
       FROM organ_donors od
       JOIN donors d ON d.donor_id = od.donor_id
       JOIN users u ON u.user_id = d.user_id
       JOIN blood_groups bg ON bg.blood_group_id = d.blood_group_id
      WHERE od.donor_id = ?`,
    [donorId],
  );
  if (!record) return null;

  record.pledges = await query(
    `SELECT p.pledge_id AS pledgeId, p.organ_type_id AS organTypeId, ot.name AS organType,
            ot.code AS organTypeCode, p.pledged_at AS pledgedAt, p.status
       FROM organ_donor_pledges p
       JOIN organ_types ot ON ot.organ_type_id = p.organ_type_id
      WHERE p.organ_donor_id = ? AND p.status = 'ACTIVE'
      ORDER BY ot.name`,
    [record.organDonorId],
  );
  return record;
}

/* ==========================================================================
 * AVAILABLE ORGANS
 * ======================================================================== */

const ORGAN_SORTS = {
  viability: 'viable_until', recovered: 'recovered_at', type: 'organ_type', age: 'donor_age',
};

/**
 * Organ availability search.  Reads v_available_organs, which exposes only
 * clinical attributes -- no donor name, user id or address ever reaches the
 * client from this endpoint.
 */
export async function searchOrgans(filters, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, ORGAN_SORTS, 'viable_until', 'ASC');

  const where = [];
  const params = [];
  if (filters.organTypeId)  { where.push('organ_type_id = ?');       params.push(filters.organTypeId); }
  if (filters.bloodGroupId) { where.push('blood_group_id = ?');      params.push(filters.bloodGroupId); }
  if (filters.cityId)       { where.push('city_id = ?');             params.push(filters.cityId); }
  if (filters.region)       { where.push('region = ?');              params.push(filters.region); }
  if (filters.centerId)     { where.push('center_id = ?');           params.push(filters.centerId); }
  if (filters.status)       { where.push('availability_status = ?'); params.push(filters.status); }
  else                      { where.push("availability_status = 'AVAILABLE'"); }
  if (filters.onlyViable !== false) { where.push('viable_until > NOW()'); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT organ_id AS organId, organ_code AS organCode, organ_type_id AS organTypeId,
            organ_type AS organType, organ_type_code AS organTypeCode,
            blood_group_id AS bloodGroupId, blood_group AS bloodGroup, donor_age AS donorAge,
            medical_status AS medicalStatus, availability_status AS availabilityStatus,
            recovered_at AS recoveredAt, viable_until AS viableUntil, hours_remaining AS hoursRemaining,
            center_id AS centerId, transplant_center AS transplantCenter,
            city_id AS cityId, city, state, region, donor_kind AS donorKind
       FROM v_available_organs
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM v_available_organs ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

/** Record a recovered organ.  viable_until is derived by the database trigger. */
export async function createOrgan(input, actor) {
  const centerId = actor.role === ROLES.TRANSPLANT_CENTER ? actor.centerId : input.centerId;
  if (!centerId) throw ApiError.badRequest('A transplant centre must be specified');

  const donor = await queryOne(
    `SELECT od.organ_donor_id, od.consent_status, od.medical_status
       FROM organ_donors od WHERE od.organ_donor_id = ?`,
    [input.organDonorId],
  );
  if (!donor) throw ApiError.notFound('Organ donor not found');
  if (donor.consent_status !== 'CONSENTED') {
    throw ApiError.conflict('An organ cannot be listed for a donor who has not consented');
  }

  const center = await queryOne(
    `SELECT tc.center_id, h.city_id FROM transplant_centers tc
       JOIN hospitals h ON h.hospital_id = tc.hospital_id WHERE tc.center_id = ?`,
    [centerId],
  );
  if (!center) throw ApiError.badRequest('The specified transplant centre does not exist');

  const code = await nextRequestCode('ORG', 'available_organs', 'organ_code');
  const result = await query(
    `INSERT INTO available_organs
       (organ_code, organ_donor_id, organ_type_id, blood_group_id, center_id, city_id,
        donor_age, hla_type, medical_status, availability_status, recovered_at, viable_until, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, NULL, ?)`,
    [code, input.organDonorId, input.organTypeId, input.bloodGroupId, centerId,
     input.cityId ?? center.city_id, input.donorAge, input.hlaType ?? null,
     input.medicalStatus ?? 'UNDER_EVALUATION', input.recoveredAt, input.notes ?? null],
  );

  await recordAudit({
    userId: actor.userId, action: 'ORGAN_LISTED', entityName: 'available_organs',
    entityId: result.insertId, description: `Organ ${code} listed`,
  });
  return getOrgan(result.insertId);
}

export async function getOrgan(organId) {
  const organ = await queryOne(
    `SELECT organ_id AS organId, organ_code AS organCode, organ_type_id AS organTypeId,
            organ_type AS organType, blood_group_id AS bloodGroupId, blood_group AS bloodGroup,
            donor_age AS donorAge, medical_status AS medicalStatus,
            availability_status AS availabilityStatus, recovered_at AS recoveredAt,
            viable_until AS viableUntil, hours_remaining AS hoursRemaining,
            center_id AS centerId, transplant_center AS transplantCenter,
            city, state, region, donor_kind AS donorKind
       FROM v_available_organs WHERE organ_id = ?`,
    [organId],
  );
  if (!organ) throw ApiError.notFound('Organ not found');
  return organ;
}

export async function updateOrganStatus(organId, input, actor) {
  const organ = await queryOne(
    'SELECT center_id, availability_status, medical_status FROM available_organs WHERE organ_id = ?', [organId],
  );
  if (!organ) throw ApiError.notFound('Organ not found');
  if (actor.role === ROLES.TRANSPLANT_CENTER && actor.centerId !== organ.center_id) {
    throw ApiError.forbidden('You can only update organs held at your own centre');
  }

  await query(
    `UPDATE available_organs
        SET availability_status = COALESCE(?, availability_status),
            medical_status      = COALESCE(?, medical_status)
      WHERE organ_id = ?`,
    [input.availabilityStatus ?? null, input.medicalStatus ?? null, organId],
  );
  await recordAudit({
    userId: actor.userId, action: 'ORGAN_STATUS_UPDATED', entityName: 'available_organs',
    entityId: organId,
    description: `availability=${input.availabilityStatus ?? organ.availability_status}, medical=${input.medicalStatus ?? organ.medical_status}`,
  });
  return getOrgan(organId);
}

/* ==========================================================================
 * ORGAN REQUESTS  &  MATCHING
 * ======================================================================== */

export async function createOrganRequest(input, actor) {
  const hospitalId = actor.role === ROLES.HOSPITAL ? actor.hospitalId : input.hospitalId;
  if (!hospitalId) throw ApiError.badRequest('A hospital must be specified for the request');

  let recipientId = input.recipientId;
  if (actor.role === ROLES.RECIPIENT) recipientId = actor.recipientId;
  if (!recipientId) throw ApiError.badRequest('A recipient must be specified for an organ request');

  const recipient = await queryOne(
    'SELECT fn_calculate_age(date_of_birth) AS age, blood_group_id FROM recipients WHERE recipient_id = ?',
    [recipientId],
  );
  if (!recipient) throw ApiError.badRequest('The specified recipient does not exist');

  const code = await nextRequestCode('OR', 'organ_requests', 'request_code');
  const result = await query(
    `INSERT INTO organ_requests
       (request_code, recipient_id, hospital_id, organ_type_id, blood_group_id,
        urgency, medical_priority, recipient_age, required_by, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, recipientId, hospitalId, input.organTypeId,
     input.bloodGroupId ?? recipient.blood_group_id, input.urgency,
     input.medicalPriority, recipient.age, input.requiredBy ?? null,
     input.notes ?? null, actor.userId],
  );

  await recordAudit({
    userId: actor.userId, action: 'ORGAN_REQUEST_CREATED', entityName: 'organ_requests',
    entityId: result.insertId, description: `${code}: ${input.urgency}, priority ${input.medicalPriority}`,
  });
  return getOrganRequest(result.insertId);
}

export async function getOrganRequest(requestId) {
  const request = await queryOne(
    `SELECT orq.organ_request_id AS organRequestId, orq.request_code AS requestCode,
            orq.urgency, orq.medical_priority AS medicalPriority, orq.recipient_age AS recipientAge,
            orq.request_date AS requestDate, orq.required_by AS requiredBy, orq.status, orq.notes,
            ot.organ_type_id AS organTypeId, ot.name AS organType, ot.code AS organTypeCode,
            bg.blood_group_id AS bloodGroupId, bg.group_code AS bloodGroup,
            h.hospital_id AS hospitalId, h.name AS hospital, ci.name AS city, ci.region,
            r.recipient_id AS recipientId, ru.full_name AS recipientName
       FROM organ_requests orq
       JOIN organ_types ot ON ot.organ_type_id = orq.organ_type_id
       JOIN blood_groups bg ON bg.blood_group_id = orq.blood_group_id
       JOIN hospitals h ON h.hospital_id = orq.hospital_id
       JOIN cities ci ON ci.city_id = h.city_id
       JOIN recipients r ON r.recipient_id = orq.recipient_id
       JOIN users ru ON ru.user_id = r.user_id
      WHERE orq.organ_request_id = ?`,
    [requestId],
  );
  if (!request) throw ApiError.notFound('Organ request not found');
  request.matches = await listMatches(requestId);
  return request;
}

export function listMatches(requestId) {
  return query(
    `SELECT match_id AS matchId, match_status AS matchStatus,
            compatibility_score AS compatibilityScore,
            blood_score AS bloodScore, urgency_score AS urgencyScore,
            priority_score AS priorityScore, location_score AS locationScore, age_score AS ageScore,
            match_reason AS matchReason, matched_at AS matchedAt,
            organ_id AS organId, organ_code AS organCode, donor_age AS donorAge,
            viable_until AS viableUntil, organ_status AS organStatus,
            organ_blood_group AS organBloodGroup, holding_center AS holdingCenter,
            organ_city AS organCity
       FROM v_organ_request_matches
      WHERE organ_request_id = ?
      ORDER BY compatibility_score DESC`,
    [requestId],
  );
}

const ORGAN_REQUEST_SORTS = {
  date: 'orq.request_date', priority: 'orq.medical_priority',
  urgency: "FIELD(orq.urgency,'ROUTINE','URGENT','CRITICAL')", status: 'orq.status',
};

export async function listOrganRequests(filters, queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, ORGAN_REQUEST_SORTS, 'orq.medical_priority');

  const where = [];
  const params = [];
  if (filters.hospitalId)  { where.push('orq.hospital_id = ?');   params.push(filters.hospitalId); }
  if (filters.recipientId) { where.push('orq.recipient_id = ?');  params.push(filters.recipientId); }
  if (filters.organTypeId) { where.push('orq.organ_type_id = ?'); params.push(filters.organTypeId); }
  if (filters.status)      { where.push('orq.status = ?');        params.push(filters.status); }
  if (filters.urgency)     { where.push('orq.urgency = ?');       params.push(filters.urgency); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT orq.organ_request_id AS organRequestId, orq.request_code AS requestCode,
            orq.urgency, orq.medical_priority AS medicalPriority, orq.recipient_age AS recipientAge,
            orq.request_date AS requestDate, orq.status,
            ot.name AS organType, bg.group_code AS bloodGroup,
            h.name AS hospital, h.hospital_id AS hospitalId, ci.name AS city,
            ru.full_name AS recipientName,
            (SELECT COUNT(*) FROM organ_matches om
              WHERE om.organ_request_id = orq.organ_request_id) AS matchCount
       FROM organ_requests orq
       JOIN organ_types ot ON ot.organ_type_id = orq.organ_type_id
       JOIN blood_groups bg ON bg.blood_group_id = orq.blood_group_id
       JOIN hospitals h ON h.hospital_id = orq.hospital_id
       JOIN cities ci ON ci.city_id = h.city_id
       JOIN recipients r ON r.recipient_id = orq.recipient_id
       JOIN users ru ON ru.user_id = r.user_id
       ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM organ_requests orq ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

/**
 * Run the matching algorithm for a request.
 *
 * SIMPLIFIED ACADEMIC SIMULATION -- the score is a weighted sum read from the
 * matching_config table, computed entirely inside sp_find_organ_matches.
 */
export async function runMatching(requestId, actor) {
  const request = await queryOne(
    'SELECT status, hospital_id FROM organ_requests WHERE organ_request_id = ?', [requestId],
  );
  if (!request) throw ApiError.notFound('Organ request not found');
  if (['CANCELLED', 'REJECTED', 'EXPIRED', 'TRANSPLANT_COMPLETED'].includes(request.status)) {
    throw ApiError.conflict(`Matching cannot be run on a ${request.status} request`);
  }

  const connection = await pool.getConnection();
  try {
    await connection.query('CALL sp_find_organ_matches(?, ?, @count)', [requestId, actor.userId]);
    const [[out]] = await connection.query('SELECT @count AS matchCount');
    const detail = await getOrganRequest(requestId);
    return {
      matchCount: Number(out.matchCount ?? 0),
      request: detail,
      algorithm: 'Weighted score: blood 40%, urgency 25%, medical priority 20%, location 10%, age 5% (weights read from matching_config).',
      disclaimer: 'Simplified academic simulation; not a clinical allocation decision.',
    };
  } finally {
    connection.release();
  }
}

/** Accept / reject / allocate / complete a proposed match. */
export async function updateMatchStatus(matchId, newStatus, actor) {
  const match = await queryOne(
    `SELECT om.match_id, om.status, om.organ_id, om.organ_request_id, ao.center_id, ao.availability_status
       FROM organ_matches om
       JOIN available_organs ao ON ao.organ_id = om.organ_id
      WHERE om.match_id = ?`,
    [matchId],
  );
  if (!match) throw ApiError.notFound('Match not found');

  if (actor.role === ROLES.TRANSPLANT_CENTER && actor.centerId !== match.center_id) {
    throw ApiError.forbidden('You can only decide on matches for organs held at your own centre');
  }
  if (!canTransition(ORGAN_MATCH_TRANSITIONS, match.status, newStatus)) {
    throw ApiError.conflict(
      `Cannot move a match from ${match.status} to ${newStatus}. ` +
      `Allowed: ${ORGAN_MATCH_TRANSITIONS[match.status]?.join(', ') || 'none (terminal state)'}.`,
    );
  }

  await withTransaction(async (cx) => {
    // Allocating an organ must not race another centre allocating the same organ.
    const [organRows] = await cx.execute(
      'SELECT availability_status FROM available_organs WHERE organ_id = ? FOR UPDATE', [match.organ_id],
    );
    const organStatus = organRows[0]?.availability_status;

    if (newStatus === 'ALLOCATED') {
      if (organStatus !== 'AVAILABLE') {
        throw ApiError.conflict(`This organ is no longer available (current status: ${organStatus})`);
      }
      await cx.execute(
        "UPDATE available_organs SET availability_status = 'ALLOCATED' WHERE organ_id = ?", [match.organ_id],
      );
      await cx.execute(
        "UPDATE organ_requests SET status = 'ALLOCATED' WHERE organ_request_id = ?", [match.organ_request_id],
      );
      // Every other proposal for this organ is now moot.
      await cx.execute(
        "UPDATE organ_matches SET status = 'CANCELLED' WHERE organ_id = ? AND match_id <> ? AND status = 'PROPOSED'",
        [match.organ_id, matchId],
      );
    }

    if (newStatus === 'COMPLETED') {
      await cx.execute(
        "UPDATE available_organs SET availability_status = 'TRANSPLANTED' WHERE organ_id = ?", [match.organ_id],
      );
      await cx.execute(
        "UPDATE organ_requests SET status = 'TRANSPLANT_COMPLETED' WHERE organ_request_id = ?",
        [match.organ_request_id],
      );
    }

    if ((newStatus === 'REJECTED' || newStatus === 'CANCELLED') && match.status === 'ALLOCATED') {
      // Release the organ back to the pool.
      await cx.execute(
        "UPDATE available_organs SET availability_status = 'AVAILABLE' WHERE organ_id = ?", [match.organ_id],
      );
      await cx.execute(
        "UPDATE organ_requests SET status = 'MATCH_FOUND' WHERE organ_request_id = ?", [match.organ_request_id],
      );
    }

    await cx.execute(
      'UPDATE organ_matches SET status = ?, decided_by = ? WHERE match_id = ?',
      [newStatus, actor.userId, matchId],
    );
  });

  await recordAudit({
    userId: actor.userId, action: 'ORGAN_MATCH_DECIDED', entityName: 'organ_matches',
    entityId: matchId, description: `${match.status} -> ${newStatus}`,
  });
  return getOrganRequest(match.organ_request_id);
}

export async function updateOrganRequestStatus(requestId, newStatus, actor) {
  const request = await queryOne(
    'SELECT status, hospital_id FROM organ_requests WHERE organ_request_id = ?', [requestId],
  );
  if (!request) throw ApiError.notFound('Organ request not found');
  if (actor.role === ROLES.HOSPITAL && actor.hospitalId !== request.hospital_id) {
    throw ApiError.forbidden('You can only update your own hospital\'s requests');
  }
  if (!canTransition(ORGAN_REQUEST_TRANSITIONS, request.status, newStatus)) {
    throw ApiError.conflict(
      `Cannot move an organ request from ${request.status} to ${newStatus}. ` +
      `Allowed: ${ORGAN_REQUEST_TRANSITIONS[request.status]?.join(', ') || 'none (terminal state)'}.`,
    );
  }

  await query('UPDATE organ_requests SET status = ? WHERE organ_request_id = ?', [newStatus, requestId]);
  await recordAudit({
    userId: actor.userId, action: 'ORGAN_REQUEST_STATUS_SET', entityName: 'organ_requests',
    entityId: requestId, description: `${request.status} -> ${newStatus}`,
  });
  return getOrganRequest(requestId);
}
