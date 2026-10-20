import asyncHandler from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/respond.js';
import * as directory from '../services/directoryService.js';
import * as notifications from '../services/notificationService.js';

const q = (req) => req.validatedQuery ?? req.query;

const page = (handler) => asyncHandler(async (req, res) => {
  const result = await handler(q(req));
  return paginated(res, result.rows, result);
});

export const listUsers          = page(directory.listUsers);
export const listDonors         = page(directory.listDonors);
export const listRecipients     = page(directory.listRecipients);
export const listHospitals      = page(directory.listHospitals);
export const listBloodBanks     = page(directory.listBloodBanks);
export const listTransplantCenters = page(directory.listTransplantCenters);
export const listAuditLogs      = page(directory.listAuditLogs);

export const getUser = asyncHandler(async (req, res) => ok(res, await directory.getUser(req.params.id)));

export const setUserStatus = asyncHandler(async (req, res) =>
  ok(res, await directory.setUserStatus(req.params.id, req.body.status, req.user)));

export const deleteUser = asyncHandler(async (req, res) =>
  ok(res, await directory.deleteUser(req.params.id, req.user)));

export const setHospitalStatus = asyncHandler(async (req, res) =>
  ok(res, await directory.setInstitutionStatus('hospitals', 'hospital_id', req.params.id, req.body.status, req.user)));

export const setBloodBankStatus = asyncHandler(async (req, res) =>
  ok(res, await directory.setInstitutionStatus('blood_banks', 'blood_bank_id', req.params.id, req.body.status, req.user)));

export const setCenterStatus = asyncHandler(async (req, res) =>
  ok(res, await directory.setInstitutionStatus('transplant_centers', 'center_id', req.params.id, req.body.status, req.user)));

/* Notifications (own account only) */
export const listNotifications = asyncHandler(async (req, res) => {
  const result = await notifications.list(req.user.userId, q(req));
  return paginated(res, result.rows, result);
});

export const unreadCount = asyncHandler(async (req, res) =>
  ok(res, await notifications.unreadCount(req.user.userId)));

export const markRead = asyncHandler(async (req, res) =>
  ok(res, await notifications.markRead(req.params.id, req.user.userId)));

export const markAllRead = asyncHandler(async (req, res) =>
  ok(res, await notifications.markAllRead(req.user.userId)));
