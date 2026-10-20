import { z } from 'zod';
import { id, optionalId, isoDate, isoDateTime, urgency, shortText, paginationQuery } from './common.js';

export const organDonorSchema = z.object({
  donorKind: z.enum(['LIVING', 'DECEASED']),
  consentStatus: z.enum(['PENDING', 'CONSENTED', 'WITHDRAWN']),
  nextOfKin: shortText(120),
  notes: shortText(500),
  organTypeIds: z.array(id).max(20).optional().default([]),
});

export const organsQuerySchema = paginationQuery.extend({
  organTypeId: optionalId,
  bloodGroupId: optionalId,
  cityId: optionalId,
  centerId: optionalId,
  region: z.string().trim().max(40).optional(),
  status: z.enum(['AVAILABLE','RESERVED','ALLOCATED','TRANSPLANTED','EXPIRED','DISCARDED']).optional(),
});

export const createOrganSchema = z.object({
  organDonorId: id,
  organTypeId: id,
  bloodGroupId: id,
  centerId: optionalId,
  cityId: optionalId,
  donorAge: z.coerce.number().int().min(1).max(100),
  hlaType: shortText(60),
  medicalStatus: z.enum(['UNDER_EVALUATION', 'VIABLE', 'NOT_VIABLE']).optional(),
  recoveredAt: isoDateTime,
  notes: shortText(500),
});

export const organStatusSchema = z.object({
  availabilityStatus: z.enum(['AVAILABLE','RESERVED','ALLOCATED','TRANSPLANTED','EXPIRED','DISCARDED']).optional(),
  medicalStatus: z.enum(['UNDER_EVALUATION', 'VIABLE', 'NOT_VIABLE']).optional(),
}).refine((data) => data.availabilityStatus || data.medicalStatus,
  { message: 'Supply at least one status to update' });

export const createOrganRequestSchema = z.object({
  recipientId: optionalId,
  hospitalId: optionalId,
  organTypeId: id,
  bloodGroupId: optionalId,
  urgency,
  medicalPriority: z.coerce.number().int().min(0).max(100),
  requiredBy: isoDate.optional().nullable(),
  notes: shortText(500),
});

export const organRequestsQuerySchema = paginationQuery.extend({
  hospitalId: optionalId,
  recipientId: optionalId,
  organTypeId: optionalId,
  status: z.enum(['PENDING','MATCHING','MATCH_FOUND','ALLOCATED','TRANSPLANT_COMPLETED','REJECTED','CANCELLED','EXPIRED']).optional(),
  urgency: urgency.optional(),
});

export const matchStatusSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED', 'ALLOCATED', 'COMPLETED', 'CANCELLED']),
});

export const organRequestStatusSchema = z.object({
  status: z.enum(['PENDING','MATCHING','MATCH_FOUND','ALLOCATED','TRANSPLANT_COMPLETED','REJECTED','CANCELLED','EXPIRED']),
});
