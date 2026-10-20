import { Router } from 'express';
import * as controller from '../controllers/analyticsController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = Router();

/** Public landing-page statistics -- aggregate counts only, no personal data. */
router.get('/public', controller.publicStats);

router.get('/overview', authenticate, controller.overview);
router.get('/blood',    authenticate, controller.bloodAnalytics);
router.get('/organs',   authenticate, controller.organAnalytics);

router.get('/hospitals', authenticate,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER), controller.hospitals);

router.get('/top-donors', authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK), controller.topDonors);

export default router;
