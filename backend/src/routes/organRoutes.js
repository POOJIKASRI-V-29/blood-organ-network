import { Router } from 'express';
import * as controller from '../controllers/organController.js';
import { authenticate, authorize, requireActive, requireProfile } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  organDonorSchema, organsQuerySchema, createOrganSchema, organStatusSchema,
  createOrganRequestSchema, organRequestsQuerySchema, matchStatusSchema, organRequestStatusSchema,
} from '../validators/organValidators.js';
import { ROLES } from '../config/constants.js';

const router = Router();

/* --- Organ donor registration (donors act on their own record only) --- */
router.get('/donors/me', authenticate,
  authorize(ROLES.DONOR), requireProfile('donorId'), controller.myOrganDonation);

router.post('/donors/me', authenticate, requireActive,
  authorize(ROLES.DONOR), requireProfile('donorId'),
  validateBody(organDonorSchema), controller.registerOrganDonor);

/* --- Organ availability --- */
router.get('/availability', authenticate,
  validateQuery(organsQuerySchema), controller.availability);

router.get('/:id', authenticate, validateParams(idParam), controller.getOrgan);

router.post('/', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.TRANSPLANT_CENTER),
  validateBody(createOrganSchema), controller.createOrgan);

router.patch('/:id/status', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.TRANSPLANT_CENTER),
  validateParams(idParam), validateBody(organStatusSchema), controller.updateOrganStatus);

export default router;
