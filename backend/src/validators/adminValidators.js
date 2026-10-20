import { z } from 'zod';
import { paginationQuery } from './common.js';
import { ALL_ROLES } from '../config/constants.js';

export const usersQuerySchema = paginationQuery.extend({
  role: z.enum(ALL_ROLES).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
});

export const userStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']),
});

export const institutionStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']),
});

export const auditQuerySchema = paginationQuery.extend({
  action: z.string().trim().max(60).optional(),
  entityName: z.string().trim().max(60).optional(),
  source: z.enum(['API', 'TRIGGER', 'PROCEDURE']).optional(),
});
