import { Router } from 'express';
import * as controller from '../controllers/directoryController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { idParam, paginationQuery } from '../validators/common.js';
import {
  usersQuerySchema, userStatusSchema, institutionStatusSchema, auditQuerySchema,
} from '../validators/adminValidators.js';
import { ROLES } from '../config/constants.js';

const router = Router();

/* --- Users: administrators only --- */
router.get   ('/users',            authenticate, authorize(ROLES.ADMIN), validateQuery(usersQuerySchema), controller.listUsers);
router.get   ('/users/:id',        authenticate, authorize(ROLES.ADMIN), validateParams(idParam), controller.getUser);
router.patch ('/users/:id/status', authenticate, authorize(ROLES.ADMIN), validateParams(idParam), validateBody(userStatusSchema), controller.setUserStatus);
router.delete('/users/:id',        authenticate, authorize(ROLES.ADMIN), validateParams(idParam), controller.deleteUser);

/* --- Donor / recipient directories --- */
router.get('/donors', authenticate,
  authorize(ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.HOSPITAL),
  validateQuery(paginationQuery), controller.listDonors);

router.get('/recipients', authenticate,
  authorize(ROLES.ADMIN, ROLES.HOSPITAL, ROLES.TRANSPLANT_CENTER),
  validateQuery(paginationQuery), controller.listRecipients);

/* --- Institutions: readable by any signed-in user (needed to fill dropdowns) --- */
router.get('/hospitals',          authenticate, validateQuery(paginationQuery), controller.listHospitals);
router.get('/blood-banks',        authenticate, validateQuery(paginationQuery), controller.listBloodBanks);
router.get('/transplant-centers', authenticate, validateQuery(paginationQuery), controller.listTransplantCenters);

router.patch('/hospitals/:id/status',          authenticate, authorize(ROLES.ADMIN), validateParams(idParam), validateBody(institutionStatusSchema), controller.setHospitalStatus);
router.patch('/blood-banks/:id/status',        authenticate, authorize(ROLES.ADMIN), validateParams(idParam), validateBody(institutionStatusSchema), controller.setBloodBankStatus);
router.patch('/transplant-centers/:id/status', authenticate, authorize(ROLES.ADMIN), validateParams(idParam), validateBody(institutionStatusSchema), controller.setCenterStatus);

/* --- Audit log --- */
router.get('/audit-logs', authenticate, authorize(ROLES.ADMIN), validateQuery(auditQuerySchema), controller.listAuditLogs);

/* --- Notifications: always scoped to the signed-in account --- */
router.get  ('/notifications',             authenticate, validateQuery(paginationQuery), controller.listNotifications);
router.get  ('/notifications/unread-count', authenticate, controller.unreadCount);
router.patch('/notifications/read-all',    authenticate, controller.markAllRead);
router.patch('/notifications/:id/read',    authenticate, validateParams(idParam), controller.markRead);

export default router;
