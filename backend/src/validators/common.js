import { z } from 'zod';

export const id = z.coerce.number().int().positive();
export const optionalId = z.coerce.number().int().positive().optional();

export const idParam = z.object({ id });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');
export const isoDateTime = z.string().min(10, 'Expected a date/time value');

export const urgency = z.enum(['ROUTINE', 'URGENT', 'CRITICAL']);
export const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);

/**
 * Password policy: at least 8 characters with a letter, a digit and a symbol.
 * Enforced here so the rule lives in one place and both register and
 * change-password use exactly the same definition.
 */
export const password = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

export const phone = z.string().trim().max(20).optional().nullable();
export const shortText = (max = 255) => z.string().trim().max(max).optional().nullable();

/** Reject a date of birth that is in the future or implies an age over 120. */
export const dateOfBirth = isoDate.refine((value) => {
  const dob = new Date(value);
  const now = new Date();
  if (Number.isNaN(dob.getTime())) return false;
  if (dob > now) return false;
  return now.getFullYear() - dob.getFullYear() <= 120;
}, 'Enter a valid date of birth');

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.string().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().max(120).optional(),
}).passthrough();
