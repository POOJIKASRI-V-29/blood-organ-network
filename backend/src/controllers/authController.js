import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/respond.js';
import * as authService from '../services/authService.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req.ip);
  return created(res, result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body.email, req.body.password, req.ip);
  return ok(res, result);
});

export const me = asyncHandler(async (req, res) => ok(res, await authService.getProfile(req.user)));

/**
 * JWTs are stateless, so "logout" is the client discarding its token.  The
 * endpoint exists so the action is recorded in the audit trail.
 */
export const logout = asyncHandler(async (req, res) => {
  const { recordAudit } = await import('../utils/audit.js');
  await recordAudit({
    userId: req.user.userId, action: 'LOGOUT', entityName: 'users',
    entityId: req.user.userId, description: 'Signed out', ipAddress: req.ip,
  });
  return ok(res, { loggedOut: true });
});

export const changePassword = asyncHandler(async (req, res) =>
  ok(res, await authService.changePassword(req.user.userId, req.body.currentPassword, req.body.newPassword)));

export const updateProfile = asyncHandler(async (req, res) =>
  ok(res, await authService.updateOwnProfile(req.user, req.body)));
