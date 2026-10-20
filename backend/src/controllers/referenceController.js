import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as reference from '../services/referenceService.js';
import { MEDICAL_DISCLAIMER } from '../config/constants.js';

/** One call returns everything the frontend caches at startup. */
export const bootstrap = asyncHandler(async (_req, res) => {
  const [cities, bloodGroups, bloodComponents, organTypes] = await Promise.all([
    reference.listCities(),
    reference.listBloodGroups(),
    reference.listBloodComponents(),
    reference.listOrganTypes(),
  ]);
  return ok(res, { cities, bloodGroups, bloodComponents, organTypes, disclaimer: MEDICAL_DISCLAIMER });
});

export const cities          = asyncHandler(async (_q, res) => ok(res, await reference.listCities()));
export const bloodGroups     = asyncHandler(async (_q, res) => ok(res, await reference.listBloodGroups()));
export const bloodComponents = asyncHandler(async (_q, res) => ok(res, await reference.listBloodComponents()));
export const organTypes      = asyncHandler(async (_q, res) => ok(res, await reference.listOrganTypes()));

export const compatibility = asyncHandler(async (req, res) => {
  const componentId = Number(req.query.componentId) || 2;   // default: red cells
  return ok(res, await reference.getCompatibilityMatrix(componentId));
});

export const matchingConfig = asyncHandler(async (_q, res) => ok(res, await reference.getMatchingConfig()));
