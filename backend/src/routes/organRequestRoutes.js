import { Router } from 'express';
import * as controller from '../controllers/organController.js';
import { authenticate, authorize, requireActive } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import {
  createOrganRequestSchema, organRequestsQuerySchema, matchStatusSchema, organRequestStatusSchema,
} from '../validators/organValidators.js';
import { ROLES } from '../config/constants.js';

/**
 * Mounted at /api/organ-requests.  Kept separate from /api/organs so that
 * '/organs/:id' cannot shadow '/organs/requests'.
 */
const router = Router();

router.get('/', authenticate, validateQuery(organRequestsQuerySchema), controller.listRequests);

router.post('/', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.RECIPIENT, ROLES.TRANSPLANT_CENTER),
  validateBody(createOrganRequestSchema), controller.createRequest);

router.get('/:id', authenticate, validateParams(idParam), controller.getRequest);

router.get('/:id/matches', authenticate, validateParams(idParam), controller.listMatches);

router.post('/:id/match', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER),
  validateParams(idParam), controller.runMatching);

router.patch('/:id/status', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER),
  validateParams(idParam), validateBody(organRequestStatusSchema), controller.updateRequestStatus);

/* Match decisions are keyed by match id, not request id. */
router.patch('/matches/:id/status', authenticate, requireActive,
  authorize(ROLES.ADMIN, ROLES.TRANSPLANT_CENTER, ROLES.HOSPITAL),
  validateParams(idParam), validateBody(matchStatusSchema), controller.updateMatchStatus);

export default router;
