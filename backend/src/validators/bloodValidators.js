import { z } from 'zod';
import { id, optionalId, isoDate, urgency, shortText, paginationQuery } from './common.js';

export const availabilityQuerySchema = paginationQuery.extend({
  recipientBloodGroupId: optionalId,
  componentId: optionalId,
  cityId: optionalId,
  bloodBankId: optionalId,
  minUnits: z.coerce.number().int().min(1).max(100).optional(),
});

export const unitsQuerySchema = paginationQuery.extend({
  bloodBankId: optionalId,
  bloodGroupId: optionalId,
  componentId: optionalId,
  status: z.enum(['AVAILABLE','RESERVED','ISSUED','TRANSFUSED','EXPIRED','DISCARDED','QUARANTINED']).optional(),
});

export const createDonationSchema = z.object({
  donorId: id,
  // Optional: a BLOOD_BANK account is bound to its own bank by the controller.
  // An ADMIN must supply one; the service enforces that.
  bloodBankId: optionalId,
  donationDate: isoDate,
  volumeMl: z.coerce.number().int().min(100).max(600).optional(),
  hemoglobinGdl: z.coerce.number().min(5).max(25).optional().nullable(),
  notes: shortText(255),
  components: z.array(z.object({
    componentId: id,
    volumeMl: z.coerce.number().int().min(20).max(600).optional(),
  })).min(1).max(5).optional(),
}).refine((data) => new Date(data.donationDate) <= new Date(),
  { message: 'A donation cannot be recorded with a future date', path: ['donationDate'] });

export const donationsQuerySchema = paginationQuery.extend({
  donorId: optionalId,
  bloodBankId: optionalId,
  screeningStatus: z.enum(['PENDING', 'PASSED', 'FAILED']).optional(),
});

export const screeningSchema = z.object({
  screeningStatus: z.enum(['PASSED', 'FAILED']),
});

export const createRequestSchema = z.object({
  recipientId: optionalId,
  hospitalId: optionalId,
  bloodGroupId: id,
  componentId: id,
  unitsRequired: z.coerce.number().int().min(1).max(50),
  urgency,
  patientName: shortText(120),
  requiredBy: isoDate,
  notes: shortText(500),
}).refine((data) => new Date(data.requiredBy) >= new Date(new Date().toDateString()),
  { message: 'The required-by date cannot be in the past', path: ['requiredBy'] });

export const requestsQuerySchema = paginationQuery.extend({
  hospitalId: optionalId,
  recipientId: optionalId,
  bloodGroupId: optionalId,
  status: z.enum(['PENDING','MATCHING','MATCHED','ALLOCATED','FULFILLED','REJECTED','CANCELLED','EXPIRED']).optional(),
  urgency: urgency.optional(),
});

export const requestStatusSchema = z.object({
  status: z.enum(['MATCHING','MATCHED','ALLOCATED','FULFILLED','REJECTED','CANCELLED','EXPIRED','PENDING']),
});
