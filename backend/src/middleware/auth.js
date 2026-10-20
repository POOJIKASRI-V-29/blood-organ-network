import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { queryOne } from '../config/db.js';
import { ROLES } from '../config/constants.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Maps a role to the profile table that carries its domain identity, so a
 * request can be scoped to "this donor's donations" or "this hospital's
 * requests" without the client ever telling us which donor or hospital it is.
 */
const PROFILE_LOOKUP = {
  [ROLES.DONOR]:             { sql: 'SELECT donor_id       AS id FROM donors             WHERE user_id = ?', key: 'donorId' },
  [ROLES.RECIPIENT]:         { sql: 'SELECT recipient_id   AS id FROM recipients         WHERE user_id = ?', key: 'recipientId' },
  [ROLES.HOSPITAL]:          { sql: 'SELECT hospital_id    AS id FROM hospitals          WHERE user_id = ?', key: 'hospitalId' },
  [ROLES.BLOOD_BANK]:        { sql: 'SELECT blood_bank_id  AS id FROM blood_banks        WHERE user_id = ?', key: 'bloodBankId' },
  [ROLES.TRANSPLANT_CENTER]: { sql: 'SELECT center_id      AS id FROM transplant_centers WHERE user_id = ?', key: 'centerId' },
};

function extractToken(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Verify the JWT, re-load the user from the database (so a suspended or deleted
 * account stops working immediately rather than when its token expires) and
 * attach req.user.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('No authentication token supplied');

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw ApiError.unauthorized('Session expired, please sign in again');
    throw ApiError.unauthorized('Invalid authentication token');
  }

  const user = await queryOne(
    `SELECT user_id, full_name, email, phone, role, status FROM users WHERE user_id = ?`,
    [payload.sub],
  );
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status === 'SUSPENDED') throw ApiError.forbidden('This account has been suspended');
  if (user.status === 'REJECTED')  throw ApiError.forbidden('This account registration was rejected');

  req.user = {
    userId: user.user_id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
  };

  // Attach the role-specific profile id (donorId, hospitalId, ...).
  const lookup = PROFILE_LOOKUP[user.role];
  if (lookup) {
    const profile = await queryOne(lookup.sql, [user.user_id]);
    req.user[lookup.key] = profile?.id ?? null;
  }

  return next();
});

/**
 * Restrict a route to the listed roles.  ADMIN is NOT implicitly allowed --
 * every route states its own permitted roles, so the permission model can be
 * read straight off the route table.
 */
export function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden(
        `This action requires one of: ${allowedRoles.join(', ')}. Your role is ${req.user.role}.`,
      ));
    }
    return next();
  };
}

/** Only ACTIVE accounts may perform write operations. */
export function requireActive(req, _res, next) {
  if (req.user?.status !== 'ACTIVE') {
    return next(ApiError.forbidden('Your account is pending approval by an administrator'));
  }
  return next();
}

/**
 * Ensure the role actually has a completed profile before it acts on behalf of
 * one -- e.g. a HOSPITAL account with no hospitals row cannot raise requests.
 */
export function requireProfile(key) {
  return (req, _res, next) => {
    if (req.user?.[key] == null) {
      return next(ApiError.forbidden(
        'Your account has no linked profile yet. An administrator must complete your registration.',
      ));
    }
    return next();
  };
}

/** Optional auth: populates req.user when a valid token is present, else continues. */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  if (!extractToken(req)) return next();
  try {
    await new Promise((resolve, reject) => {
      authenticate(req, _res, (err) => (err ? reject(err) : resolve()));
    });
  } catch {
    req.user = undefined;
  }
  return next();
});
