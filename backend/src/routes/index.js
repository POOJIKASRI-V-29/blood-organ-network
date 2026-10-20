import { Router } from 'express';
import authRoutes from './authRoutes.js';
import referenceRoutes from './referenceRoutes.js';
import bloodRoutes from './bloodRoutes.js';
import organRoutes from './organRoutes.js';
import organRequestRoutes from './organRequestRoutes.js';
import directoryRoutes from './directoryRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import { healthCheck } from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { MEDICAL_DISCLAIMER } from '../config/constants.js';

const router = Router();

router.get('/health', asyncHandler(async (_req, res) => {
  const db = await healthCheck();
  return ok(res, { status: 'ok', database: db.db, mysqlVersion: db.version, disclaimer: MEDICAL_DISCLAIMER });
}));

router.use('/auth',           authRoutes);
router.use('/reference',      referenceRoutes);
router.use('/blood',          bloodRoutes);
router.use('/organs',         organRoutes);
router.use('/organ-requests', organRequestRoutes);
router.use('/analytics',      analyticsRoutes);
router.use('/',               directoryRoutes);   // /users, /hospitals, /notifications, ...

export default router;
