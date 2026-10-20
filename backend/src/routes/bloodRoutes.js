import { Router } from 'express';
import * as controller from '../controllers/bloodController.js';
import { authenticate, authorize, requireActive } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  availabilityQuerySchema, unitsQuerySchema, createDonationSchema, donationsQuerySchema,
  screeningSchema, createRequestSchema, requestsQuerySchema, requestStatusSchema,
} from '../validators/bloodValidators.js';
import { ROLES } from '../config/constants.js';

const router = Router();

/* --- Availability: readable by any signed-in user; exposes no donor identity --- */
router.get('/availability',         authenticate, validateQuery(availabilityQuerySchema), controller.availability);
router.get('/availability/summary', authenticate, controller.availabilitySummary);
router.get('/expiring',             authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK), controller.expiring);

/* --- Inventory --- */
router.get('/units', authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.HOSPITAL),
  validateQuery(unitsQuerySchema), controller.listUnits);

/* --- Donations --- */
router.get('/donations', authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.DONOR),
  validateQuery(donationsQuerySchema), controller.listDonations);

router.get('/donations/:id', authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.DONOR),
  validateParams(idParam), controller.getDonation);

router.post('/donations', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK),
  validateBody(createDonationSchema), controller.createDonation);

router.patch('/donations/:id/screening', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK),
  validateParams(idParam), validateBody(screeningSchema), controller.updateScreening);

/* --- Requests --- */
router.get('/requests', authenticate,
  validateQuery(requestsQuerySchema), controller.listRequests);

router.get('/requests/:id', authenticate,
  validateParams(idParam), controller.getRequest);

router.post('/requests', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.RECIPIENT),
  validateBody(createRequestSchema), controller.createRequest);

router.get('/requests/:id/match', authenticate,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.BLOOD_BANK),
  validateParams(idParam), controller.previewMatches);

router.post('/requests/:id/allocate', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.BLOOD_BANK),
  validateParams(idParam), controller.allocate);

router.patch('/requests/:id/status', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.BLOOD_BANK),
  validateParams(idParam), validateBody(requestStatusSchema), controller.updateRequestStatus);

/* --- Housekeeping --- */
router.post('/housekeeping/expire', authenticate,
  authorize(ROLES.ADMIN), controller.runExpiry);

export default router;
