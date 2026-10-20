import { query, queryOne } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { getPagination, getSort } from '../utils/pagination.js';
import { recordAudit } from '../utils/audit.js';

/* ==========================================================================
 * USERS  (admin)
 * ======================================================================== */

const USER_SORTS = { name: 'u.full_name', email: 'u.email', role: 'u.role', created: 'u.created_at', status: 'u.status' };

export async function listUsers(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, USER_SORTS, 'u.created_at');

  const where = [];
  const params = [];
  if (queryParams.role)   { where.push('u.role = ?');   params.push(queryParams.role); }
  if (queryParams.status) { where.push('u.status = ?'); params.push(queryParams.status); }
  if (queryParams.search) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${queryParams.search}%`, `%${queryParams.search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // password_hash is never selected.
  const rows = await query(
    `SELECT u.user_id AS userId, u.full_name AS fullName, u.email, u.phone, u.role, u.status,
            u.created_at AS createdAt, u.last_login_at AS lastLoginAt
       FROM users u ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM users u ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

export async function getUser(userId) {
  const user = await queryOne(
    `SELECT user_id AS userId, full_name AS fullName, email, phone, role, status,
            created_at AS createdAt, last_login_at AS lastLoginAt
       FROM users WHERE user_id = ?`,
    [userId],
  );
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

export async function setUserStatus(userId, status, actor) {
  const user = await queryOne('SELECT status, role, full_name FROM users WHERE user_id = ?', [userId]);
  if (!user) throw ApiError.notFound('User not found');
  if (Number(userId) === actor.userId) {
    throw ApiError.badRequest('You cannot change the status of your own account');
  }

  await query('UPDATE users SET status = ? WHERE user_id = ?', [status, userId]);

  // Approving an institution activates its profile record too.
  if (status === 'ACTIVE') {
    await query("UPDATE hospitals          SET status = 'ACTIVE' WHERE user_id = ?", [userId]);
    await query("UPDATE blood_banks        SET status = 'ACTIVE' WHERE user_id = ?", [userId]);
    await query("UPDATE transplant_centers SET status = 'ACTIVE' WHERE user_id = ?", [userId]);
  } else if (status === 'SUSPENDED' || status === 'REJECTED') {
    await query("UPDATE hospitals          SET status = 'SUSPENDED' WHERE user_id = ?", [userId]);
    await query("UPDATE blood_banks        SET status = 'SUSPENDED' WHERE user_id = ?", [userId]);
    await query("UPDATE transplant_centers SET status = 'SUSPENDED' WHERE user_id = ?", [userId]);
  }

  await query(
    `INSERT INTO notifications (user_id, title, message, type)
     VALUES (?, ?, ?, ?)`,
    [userId, `Your account is now ${status}`,
     `An administrator changed your account status from ${user.status} to ${status}.`,
     status === 'ACTIVE' ? 'SUCCESS' : 'WARNING'],
  );

  await recordAudit({
    userId: actor.userId, action: 'USER_STATUS_CHANGED', entityName: 'users', entityId: Number(userId),
    description: `${user.full_name}: ${user.status} -> ${status}`,
  });
  return getUser(userId);
}

/**
 * Delete a user.  Profile rows cascade (ON DELETE CASCADE); historical medical
 * records do not (ON DELETE RESTRICT), so a user with donation history cannot
 * be deleted -- which is the correct outcome, and the error explains it.
 */
export async function deleteUser(userId, actor) {
  const user = await queryOne('SELECT full_name, role FROM users WHERE user_id = ?', [userId]);
  if (!user) throw ApiError.notFound('User not found');
  if (Number(userId) === actor.userId) throw ApiError.badRequest('You cannot delete your own account');

  const donor = await queryOne('SELECT donor_id FROM donors WHERE user_id = ?', [userId]);
  if (donor) {
    const donations = await queryOne(
      'SELECT COUNT(*) AS n FROM blood_donations WHERE donor_id = ?', [donor.donor_id],
    );
    if (donations.n > 0) {
      throw ApiError.conflict(
        `${user.full_name} has ${donations.n} donation record(s). Medical history cannot be deleted; ` +
        'suspend the account instead.',
      );
    }
  }

  await query('DELETE FROM users WHERE user_id = ?', [userId]);
  await recordAudit({
    userId: actor.userId, action: 'USER_DELETED', entityName: 'users', entityId: Number(userId),
    description: `Deleted ${user.role} account ${user.full_name}`,
  });
  return { deleted: true };
}

/* ==========================================================================
 * DONORS  /  RECIPIENTS
 * ======================================================================== */

const DONOR_SORTS = { name: 'donor_name', donations: 'total_donations', city: 'city', group: 'blood_group' };

export async function listDonors(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const orderBy = getSort(queryParams, DONOR_SORTS, 'total_donations');

  const where = [];
  const params = [];
  if (queryParams.bloodGroup) { where.push('blood_group = ?');        params.push(queryParams.bloodGroup); }
  if (queryParams.city)       { where.push('city = ?');               params.push(queryParams.city); }
  if (queryParams.eligibility){ where.push('eligibility_status = ?'); params.push(queryParams.eligibility); }
  if (queryParams.search)     { where.push('donor_name LIKE ?');      params.push(`%${queryParams.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT donor_id AS donorId, user_id AS userId, donor_name AS donorName, email,
            blood_group AS bloodGroup, city, region, age, gender,
            eligibility_status AS eligibilityStatus, last_donation_date AS lastDonationDate,
            total_donations AS totalDonations, total_volume_ml AS totalVolumeMl,
            units_produced AS unitsProduced, is_organ_donor AS isOrganDonor,
            organ_consent_status AS organConsentStatus
       FROM v_donor_activity_summary ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM v_donor_activity_summary ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

export async function listRecipients(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (queryParams.search) { where.push('u.full_name LIKE ?'); params.push(`%${queryParams.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT r.recipient_id AS recipientId, u.user_id AS userId, u.full_name AS recipientName,
            u.email, bg.group_code AS bloodGroup, c.name AS city, c.region,
            fn_calculate_age(r.date_of_birth) AS age, r.gender, r.medical_notes AS medicalNotes,
            (SELECT COUNT(*) FROM blood_requests br WHERE br.recipient_id = r.recipient_id) AS bloodRequests,
            (SELECT COUNT(*) FROM organ_requests orq WHERE orq.recipient_id = r.recipient_id) AS organRequests
       FROM recipients r
       JOIN users u ON u.user_id = r.user_id
       JOIN blood_groups bg ON bg.blood_group_id = r.blood_group_id
       JOIN cities c ON c.city_id = r.city_id
       ${whereSql}
      ORDER BY u.full_name
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(
    `SELECT COUNT(*) AS total FROM recipients r JOIN users u ON u.user_id = r.user_id ${whereSql}`, params,
  );
  return { rows, page, limit, total: countRow.total };
}

/* ==========================================================================
 * INSTITUTIONS
 * ======================================================================== */

export async function listHospitals(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (queryParams.cityId) { where.push('h.city_id = ?'); params.push(queryParams.cityId); }
  if (queryParams.status) { where.push('h.status = ?');  params.push(queryParams.status); }
  if (queryParams.search) { where.push('h.name LIKE ?'); params.push(`%${queryParams.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT h.hospital_id AS hospitalId, h.name, h.registration_number AS registrationNumber,
            h.address, h.phone, h.email, h.bed_capacity AS bedCapacity, h.status,
            c.city_id AS cityId, c.name AS city, c.state, c.region, h.user_id AS userId
       FROM hospitals h JOIN cities c ON c.city_id = h.city_id
       ${whereSql}
      ORDER BY h.name
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM hospitals h ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

export async function listBloodBanks(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (queryParams.cityId) { where.push('b.city_id = ?'); params.push(queryParams.cityId); }
  if (queryParams.status) { where.push('b.status = ?');  params.push(queryParams.status); }
  if (queryParams.search) { where.push('b.name LIKE ?'); params.push(`%${queryParams.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT b.blood_bank_id AS bloodBankId, b.name, b.registration_number AS registrationNumber,
            b.address, b.phone, b.email, b.status, b.hospital_id AS hospitalId,
            c.city_id AS cityId, c.name AS city, c.state, c.region, b.user_id AS userId,
            (SELECT COUNT(*) FROM blood_units bu
              WHERE bu.blood_bank_id = b.blood_bank_id
                AND bu.status = 'AVAILABLE' AND bu.expiry_date > CURDATE()) AS availableUnits
       FROM blood_banks b JOIN cities c ON c.city_id = b.city_id
       ${whereSql}
      ORDER BY b.name
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM blood_banks b ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

export async function listTransplantCenters(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (queryParams.status) { where.push('t.status = ?');  params.push(queryParams.status); }
  if (queryParams.search) { where.push('t.name LIKE ?'); params.push(`%${queryParams.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT t.center_id AS centerId, t.name, t.license_number AS licenseNumber, t.status,
            h.hospital_id AS hospitalId, h.name AS hospitalName,
            c.city_id AS cityId, c.name AS city, c.region, t.user_id AS userId,
            (SELECT COUNT(*) FROM available_organs ao
              WHERE ao.center_id = t.center_id
                AND ao.availability_status = 'AVAILABLE' AND ao.viable_until > NOW()) AS organsHeld
       FROM transplant_centers t
       JOIN hospitals h ON h.hospital_id = t.hospital_id
       JOIN cities c ON c.city_id = h.city_id
       ${whereSql}
      ORDER BY t.name
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM transplant_centers t ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}

export async function setInstitutionStatus(table, idColumn, id, status, actor) {
  const allowed = {
    hospitals: 'hospital_id', blood_banks: 'blood_bank_id', transplant_centers: 'center_id',
  };
  if (allowed[table] !== idColumn) throw ApiError.badRequest('Unknown institution type');

  const row = await queryOne(`SELECT name, status FROM \`${table}\` WHERE \`${idColumn}\` = ?`, [id]);
  if (!row) throw ApiError.notFound('Institution not found');

  await query(`UPDATE \`${table}\` SET status = ? WHERE \`${idColumn}\` = ?`, [status, id]);
  await recordAudit({
    userId: actor.userId, action: 'INSTITUTION_STATUS_CHANGED', entityName: table, entityId: Number(id),
    description: `${row.name}: ${row.status} -> ${status}`,
  });
  return { id: Number(id), name: row.name, status };
}

/* ==========================================================================
 * AUDIT LOG (admin)
 * ======================================================================== */

export async function listAuditLogs(queryParams) {
  const { page, limit, offset } = getPagination(queryParams);
  const where = [];
  const params = [];
  if (queryParams.action)     { where.push('a.action = ?');      params.push(queryParams.action); }
  if (queryParams.entityName) { where.push('a.entity_name = ?'); params.push(queryParams.entityName); }
  if (queryParams.source)     { where.push('a.source = ?');      params.push(queryParams.source); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT a.audit_id AS auditId, a.action, a.entity_name AS entityName, a.entity_id AS entityId,
            a.description, a.source, a.ip_address AS ipAddress, a.created_at AS createdAt,
            u.full_name AS userName, u.role AS userRole
       FROM audit_logs a LEFT JOIN users u ON u.user_id = a.user_id
       ${whereSql}
      ORDER BY a.audit_id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params);
  return { rows, page, limit, total: countRow.total };
}
