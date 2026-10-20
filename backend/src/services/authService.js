import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { query, queryOne, withTransaction } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { ROLES } from '../config/constants.js';
import { recordAudit } from '../utils/audit.js';

/** Shape a users row for the client.  password_hash is never included. */
function toPublicUser(row, extra = {}) {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    ...extra,
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.user_id, role: user.role },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn },
  );
}

/**
 * Register a new account plus its role-specific profile, atomically.
 *
 * DONOR and RECIPIENT self-register and become ACTIVE immediately.
 * HOSPITAL / BLOOD_BANK / TRANSPLANT_CENTER self-register as PENDING: an
 * institution must be verified by an administrator before it can act.
 * ADMIN accounts cannot be created through this endpoint at all.
 */
export async function register(input, ipAddress) {
  if (input.role === ROLES.ADMIN) {
    throw ApiError.forbidden('Administrator accounts cannot be self-registered');
  }

  const existing = await queryOne('SELECT user_id FROM users WHERE email = ?', [input.email]);
  if (existing) throw ApiError.conflict('An account with that email address already exists');

  const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
  const selfServiceRoles = [ROLES.DONOR, ROLES.RECIPIENT];
  const status = selfServiceRoles.includes(input.role) ? 'ACTIVE' : 'PENDING';

  const userId = await withTransaction(async (cx) => {
    const [result] = await cx.execute(
      `INSERT INTO users (full_name, email, password_hash, phone, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.fullName, input.email, passwordHash, input.phone ?? null, input.role, status],
    );
    const newUserId = result.insertId;

    if (input.role === ROLES.DONOR) {
      await cx.execute(
        `INSERT INTO donors (user_id, date_of_birth, gender, blood_group_id, city_id, address, weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newUserId, input.dateOfBirth, input.gender, input.bloodGroupId,
         input.cityId, input.address ?? null, input.weightKg ?? null],
      );
    } else if (input.role === ROLES.RECIPIENT) {
      await cx.execute(
        `INSERT INTO recipients (user_id, date_of_birth, gender, blood_group_id, city_id, address, medical_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newUserId, input.dateOfBirth, input.gender, input.bloodGroupId,
         input.cityId, input.address ?? null, input.medicalNotes ?? null],
      );
    } else if (input.role === ROLES.HOSPITAL) {
      await cx.execute(
        `INSERT INTO hospitals (user_id, name, registration_number, address, city_id, phone, email, bed_capacity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [newUserId, input.organisationName, input.registrationNumber, input.address,
         input.cityId, input.phone ?? '', input.email, input.bedCapacity ?? null],
      );
    } else if (input.role === ROLES.BLOOD_BANK) {
      await cx.execute(
        `INSERT INTO blood_banks (user_id, name, registration_number, address, city_id, phone, email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [newUserId, input.organisationName, input.registrationNumber, input.address,
         input.cityId, input.phone ?? '', input.email],
      );
    } else if (input.role === ROLES.TRANSPLANT_CENTER) {
      // A transplant centre must name the hospital that hosts it.
      const [hospitalRows] = await cx.execute(
        'SELECT hospital_id FROM hospitals WHERE hospital_id = ?', [input.hospitalId],
      );
      if (!hospitalRows.length) throw ApiError.badRequest('The specified host hospital does not exist');
      await cx.execute(
        `INSERT INTO transplant_centers (hospital_id, user_id, license_number, name, status)
         VALUES (?, ?, ?, ?, 'PENDING')`,
        [input.hospitalId, newUserId, input.licenseNumber, input.organisationName],
      );
    }

    return newUserId;
  });

  const user = await queryOne(
    'SELECT user_id, full_name, email, phone, role, status, created_at FROM users WHERE user_id = ?',
    [userId],
  );

  await recordAudit({
    userId, action: 'REGISTER', entityName: 'users', entityId: userId,
    description: `Self-registration as ${input.role}`, ipAddress,
  });

  return { user: toPublicUser(user), token: signToken(user) };
}

/**
 * Authenticate by email + password.
 *
 * The same generic message is returned whether the email is unknown or the
 * password is wrong, so the endpoint cannot be used to enumerate accounts.
 * bcrypt.compare is still run against a dummy hash for unknown emails to keep
 * the response time uniform.
 */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8._q7Xv5oK8Q6O0YyV0v1Qz8wFQ3jS';

export async function login(email, password, ipAddress) {
  const row = await queryOne(
    'SELECT user_id, full_name, email, phone, role, status, password_hash, created_at FROM users WHERE email = ?',
    [email],
  );

  const matches = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    await recordAudit({
      action: 'LOGIN_FAILED', entityName: 'users',
      description: `Failed sign-in attempt for ${email}`, ipAddress,
    });
    throw ApiError.unauthorized('Incorrect email address or password');
  }

  if (row.status === 'SUSPENDED') throw ApiError.forbidden('This account has been suspended');
  if (row.status === 'REJECTED')  throw ApiError.forbidden('This account registration was rejected');

  await query('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [row.user_id]);
  await recordAudit({
    userId: row.user_id, action: 'LOGIN', entityName: 'users', entityId: row.user_id,
    description: `${row.role} signed in`, ipAddress,
  });

  return { user: toPublicUser(row), token: signToken(row) };
}

/** The authenticated user plus their role profile, for the /auth/me bootstrap call. */
export async function getProfile(reqUser) {
  const row = await queryOne(
    `SELECT user_id, full_name, email, phone, role, status, created_at, last_login_at
       FROM users WHERE user_id = ?`,
    [reqUser.userId],
  );
  if (!row) throw ApiError.notFound('Account not found');

  let profile = null;
  switch (row.role) {
    case ROLES.DONOR:
      profile = await queryOne(
        `SELECT d.donor_id AS donorId, d.date_of_birth AS dateOfBirth, d.gender,
                d.address, d.weight_kg AS weightKg, d.last_donation_date AS lastDonationDate,
                d.total_donations AS totalDonations, d.eligibility_status AS eligibilityStatus,
                bg.blood_group_id AS bloodGroupId, bg.group_code AS bloodGroup,
                c.city_id AS cityId, c.name AS city, c.state, c.region,
                fn_calculate_age(d.date_of_birth) AS age,
                od.organ_donor_id AS organDonorId, od.consent_status AS organConsentStatus
           FROM donors d
           JOIN blood_groups bg ON bg.blood_group_id = d.blood_group_id
           JOIN cities c ON c.city_id = d.city_id
           LEFT JOIN organ_donors od ON od.donor_id = d.donor_id
          WHERE d.user_id = ?`, [row.user_id]);
      break;
    case ROLES.RECIPIENT:
      profile = await queryOne(
        `SELECT r.recipient_id AS recipientId, r.date_of_birth AS dateOfBirth, r.gender,
                r.address, r.medical_notes AS medicalNotes,
                bg.blood_group_id AS bloodGroupId, bg.group_code AS bloodGroup,
                c.city_id AS cityId, c.name AS city, c.state, c.region,
                fn_calculate_age(r.date_of_birth) AS age
           FROM recipients r
           JOIN blood_groups bg ON bg.blood_group_id = r.blood_group_id
           JOIN cities c ON c.city_id = r.city_id
          WHERE r.user_id = ?`, [row.user_id]);
      break;
    case ROLES.HOSPITAL:
      profile = await queryOne(
        `SELECT h.hospital_id AS hospitalId, h.name, h.registration_number AS registrationNumber,
                h.address, h.phone, h.email, h.bed_capacity AS bedCapacity, h.status,
                c.city_id AS cityId, c.name AS city, c.state, c.region
           FROM hospitals h JOIN cities c ON c.city_id = h.city_id
          WHERE h.user_id = ?`, [row.user_id]);
      break;
    case ROLES.BLOOD_BANK:
      profile = await queryOne(
        `SELECT b.blood_bank_id AS bloodBankId, b.name, b.registration_number AS registrationNumber,
                b.address, b.phone, b.email, b.status, b.hospital_id AS hospitalId,
                c.city_id AS cityId, c.name AS city, c.state, c.region
           FROM blood_banks b JOIN cities c ON c.city_id = b.city_id
          WHERE b.user_id = ?`, [row.user_id]);
      break;
    case ROLES.TRANSPLANT_CENTER:
      profile = await queryOne(
        `SELECT t.center_id AS centerId, t.name, t.license_number AS licenseNumber, t.status,
                h.hospital_id AS hospitalId, h.name AS hospitalName,
                c.city_id AS cityId, c.name AS city, c.state, c.region
           FROM transplant_centers t
           JOIN hospitals h ON h.hospital_id = t.hospital_id
           JOIN cities c ON c.city_id = h.city_id
          WHERE t.user_id = ?`, [row.user_id]);
      break;
    default:
      profile = null;
  }

  return toPublicUser(row, { lastLoginAt: row.last_login_at, profile });
}

export async function changePassword(userId, currentPassword, newPassword) {
  const row = await queryOne('SELECT password_hash FROM users WHERE user_id = ?', [userId]);
  if (!row) throw ApiError.notFound('Account not found');

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) throw ApiError.badRequest('Your current password is incorrect');

  const hash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, userId]);
  await recordAudit({
    userId, action: 'PASSWORD_CHANGED', entityName: 'users', entityId: userId,
    description: 'Password updated by the account holder',
  });
  return { changed: true };
}

export async function updateOwnProfile(reqUser, input) {
  await withTransaction(async (cx) => {
    if (input.fullName || input.phone !== undefined) {
      await cx.execute(
        `UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE user_id = ?`,
        [input.fullName ?? null, input.phone ?? null, reqUser.userId],
      );
    }
    if (reqUser.role === ROLES.DONOR && reqUser.donorId) {
      await cx.execute(
        `UPDATE donors SET address = COALESCE(?, address), city_id = COALESCE(?, city_id),
                           weight_kg = COALESCE(?, weight_kg)
          WHERE donor_id = ?`,
        [input.address ?? null, input.cityId ?? null, input.weightKg ?? null, reqUser.donorId],
      );
    }
    if (reqUser.role === ROLES.RECIPIENT && reqUser.recipientId) {
      await cx.execute(
        `UPDATE recipients SET address = COALESCE(?, address), city_id = COALESCE(?, city_id),
                               medical_notes = COALESCE(?, medical_notes)
          WHERE recipient_id = ?`,
        [input.address ?? null, input.cityId ?? null, input.medicalNotes ?? null, reqUser.recipientId],
      );
    }
  });

  await recordAudit({
    userId: reqUser.userId, action: 'PROFILE_UPDATED', entityName: 'users', entityId: reqUser.userId,
    description: 'Profile details updated',
  });
  return getProfile(reqUser);
}
