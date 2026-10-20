import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  registerSchema, loginSchema, changePasswordSchema, updateProfileSchema,
} from '../validators/authValidators.js';

const router = Router();

/** Credential endpoints are rate limited to blunt password-guessing attacks. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many attempts. Please try again in 15 minutes.' } },
});

router.post('/register',        authLimiter, validateBody(registerSchema), controller.register);
router.post('/login',           authLimiter, validateBody(loginSchema),    controller.login);
router.post('/logout',          authenticate, controller.logout);
router.get ('/me',              authenticate, controller.me);
router.patch('/me',             authenticate, validateBody(updateProfileSchema), controller.updateProfile);
router.post('/change-password', authenticate, authLimiter, validateBody(changePasswordSchema), controller.changePassword);

export default router;
