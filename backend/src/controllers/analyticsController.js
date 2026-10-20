import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as analytics from '../services/analyticsService.js';

export const overview = asyncHandler(async (_req, res) => {
  const [summary, activity] = await Promise.all([
    analytics.getOverview(),
    analytics.getRecentActivity(12),
  ]);
  return ok(res, { ...summary, recentActivity: activity });
});

export const bloodAnalytics = asyncHandler(async (req, res) => {
  const months = Number(req.query.months) || 6;
  const [byGroup, byCity, donations, requests, mostRequested, statusBreakdown, wastage] = await Promise.all([
    analytics.unitsByBloodGroup(),
    analytics.inventoryByCity(),
    analytics.donationsPerMonth(months),
    analytics.requestsPerMonth(months),
    analytics.mostRequestedBloodGroups(),
    analytics.requestStatusBreakdown(),
    analytics.wastageByComponent(),
  ]);
  return ok(res, { byGroup, byCity, donations, requests, mostRequested, statusBreakdown, wastage });
});

export const organAnalytics = asyncHandler(async (_req, res) => {
  const [byType, byUrgency, pledges] = await Promise.all([
    analytics.organAvailabilityByType(),
    analytics.organRequestsByUrgency(),
    analytics.organDonorPledgeStats(),
  ]);
  return ok(res, { byType, byUrgency, pledges });
});

export const hospitals = asyncHandler(async (_req, res) =>
  ok(res, await analytics.hospitalRequestSummary()));

export const topDonors = asyncHandler(async (req, res) =>
  ok(res, await analytics.topDonors(Number(req.query.limit) || 10)));

/** Public: powers the landing page, no authentication required. */
export const publicStats = asyncHandler(async (_req, res) =>
  ok(res, await analytics.getPublicStats()));
