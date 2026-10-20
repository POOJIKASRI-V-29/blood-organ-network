import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, paginated } from '../utils/respond.js';
import * as blood from '../services/bloodService.js';
import { ROLES } from '../config/constants.js';

const q = (req) => req.validatedQuery ?? req.query;

export const availability = asyncHandler(async (req, res) =>
  ok(res, await blood.searchAvailability(q(req))));

export const availabilitySummary = asyncHandler(async (_req, res) =>
  ok(res, await blood.getAvailabilitySummary()));

export const expiring = asyncHandler(async (req, res) => {
  // A blood bank sees only its own expiring stock; an admin sees everything.
  const bankId = req.user.role === ROLES.BLOOD_BANK ? req.user.bloodBankId : (q(req).bloodBankId ?? null);
  return ok(res, await blood.getExpiringUnits(bankId));
});

export const listUnits = asyncHandler(async (req, res) => {
  const filters = { ...q(req) };
  if (req.user.role === ROLES.BLOOD_BANK) filters.bloodBankId = req.user.bloodBankId;
  const result = await blood.listUnits(filters, q(req));
  return paginated(res, result.rows, result);
});

export const createDonation = asyncHandler(async (req, res) => {
  const input = { ...req.body };
  if (req.user.role === ROLES.BLOOD_BANK) input.bloodBankId = req.user.bloodBankId;
  return created(res, await blood.recordDonation(input, req.user));
});

export const listDonations = asyncHandler(async (req, res) => {
  const filters = { ...q(req) };
  // A donor may only see their own donation history.
  if (req.user.role === ROLES.DONOR)      filters.donorId = req.user.donorId;
  if (req.user.role === ROLES.BLOOD_BANK) filters.bloodBankId = req.user.bloodBankId;
  const result = await blood.listDonations(filters, q(req));
  return paginated(res, result.rows, result);
});

export const getDonation = asyncHandler(async (req, res) =>
  ok(res, await blood.getDonation(req.params.id)));

export const updateScreening = asyncHandler(async (req, res) =>
  ok(res, await blood.updateScreening(req.params.id, req.body.screeningStatus, req.user)));

export const createRequest = asyncHandler(async (req, res) =>
  created(res, await blood.createRequest(req.body, req.user)));

export const listRequests = asyncHandler(async (req, res) => {
  const filters = { ...q(req) };
  if (req.user.role === ROLES.HOSPITAL)  filters.hospitalId  = req.user.hospitalId;
  if (req.user.role === ROLES.RECIPIENT) filters.recipientId = req.user.recipientId;
  const result = await blood.listRequests(filters, q(req));
  return paginated(res, result.rows, result);
});

export const getRequest = asyncHandler(async (req, res) =>
  ok(res, await blood.getRequest(req.params.id)));

export const previewMatches = asyncHandler(async (req, res) =>
  ok(res, await blood.previewMatches(req.params.id)));

export const allocate = asyncHandler(async (req, res) =>
  ok(res, await blood.allocate(req.params.id, req.user)));

export const updateRequestStatus = asyncHandler(async (req, res) =>
  ok(res, await blood.updateRequestStatus(req.params.id, req.body.status, req.user)));

export const runExpiry = asyncHandler(async (req, res) =>
  ok(res, await blood.runExpiry(req.user)));
