import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, paginated } from '../utils/respond.js';
import * as organ from '../services/organService.js';
import { ROLES, MEDICAL_DISCLAIMER } from '../config/constants.js';

const q = (req) => req.validatedQuery ?? req.query;

export const registerOrganDonor = asyncHandler(async (req, res) =>
  ok(res, await organ.registerOrganDonor(req.body, req.user)));

export const myOrganDonation = asyncHandler(async (req, res) =>
  ok(res, await organ.getOrganDonorByDonorId(req.user.donorId)));

export const availability = asyncHandler(async (req, res) => {
  const result = await organ.searchOrgans(q(req), q(req));
  return paginated(res, result.rows, result);
});

export const getOrgan = asyncHandler(async (req, res) =>
  ok(res, await organ.getOrgan(req.params.id)));

export const createOrgan = asyncHandler(async (req, res) =>
  created(res, await organ.createOrgan(req.body, req.user)));

export const updateOrganStatus = asyncHandler(async (req, res) =>
  ok(res, await organ.updateOrganStatus(req.params.id, req.body, req.user)));

export const createRequest = asyncHandler(async (req, res) =>
  created(res, await organ.createOrganRequest(req.body, req.user)));

export const listRequests = asyncHandler(async (req, res) => {
  const filters = { ...q(req) };
  if (req.user.role === ROLES.HOSPITAL)  filters.hospitalId  = req.user.hospitalId;
  if (req.user.role === ROLES.RECIPIENT) filters.recipientId = req.user.recipientId;
  const result = await organ.listOrganRequests(filters, q(req));
  return paginated(res, result.rows, result);
});

export const getRequest = asyncHandler(async (req, res) =>
  ok(res, await organ.getOrganRequest(req.params.id)));

export const runMatching = asyncHandler(async (req, res) =>
  ok(res, await organ.runMatching(req.params.id, req.user)));

export const listMatches = asyncHandler(async (req, res) =>
  ok(res, { matches: await organ.listMatches(req.params.id), disclaimer: MEDICAL_DISCLAIMER }));

export const updateMatchStatus = asyncHandler(async (req, res) =>
  ok(res, await organ.updateMatchStatus(req.params.id, req.body.status, req.user)));

export const updateRequestStatus = asyncHandler(async (req, res) =>
  ok(res, await organ.updateOrganRequestStatus(req.params.id, req.body.status, req.user)));
