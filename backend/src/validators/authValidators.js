import { z } from 'zod';
import {
  email, password, phone, gender, dateOfBirth, id, optionalId, shortText,
} from './common.js';
import { ROLES } from '../config/constants.js';

const baseRegister = {
  fullName: z.string().trim().min(2, 'Name is too short').max(120),
  email,
  password,
  phone,
};

/**
 * Registration is a discriminated union on role: a DONOR must supply clinical
 * fields, an institution must supply registration details.  Modelling it this
 * way means an institution cannot slip through without a registration number.
 */
export const registerSchema = z.discriminatedUnion('role', [
  z.object({
    ...baseRegister,
    role: z.literal(ROLES.DONOR),
    dateOfBirth,
    gender,
    bloodGroupId: id,
    cityId: id,
    address: shortText(255),
    weightKg: z.coerce.number().min(20).max(300).optional().nullable(),
  }),
  z.object({
    ...baseRegister,
    role: z.literal(ROLES.RECIPIENT),
    dateOfBirth,
    gender,
    bloodGroupId: id,
    cityId: id,
    address: shortText(255),
    medicalNotes: shortText(2000),
  }),
  z.object({
    ...baseRegister,
    role: z.literal(ROLES.HOSPITAL),
    organisationName: z.string().trim().min(3).max(160),
    registrationNumber: z.string().trim().min(3).max(60),
    address: z.string().trim().min(5).max(255),
    cityId: id,
    bedCapacity: z.coerce.number().int().positive().max(20000).optional().nullable(),
  }),
  z.object({
    ...baseRegister,
    role: z.literal(ROLES.BLOOD_BANK),
    organisationName: z.string().trim().min(3).max(160),
    registrationNumber: z.string().trim().min(3).max(60),
    address: z.string().trim().min(5).max(255),
    cityId: id,
  }),
  z.object({
    ...baseRegister,
    role: z.literal(ROLES.TRANSPLANT_CENTER),
    organisationName: z.string().trim().min(3).max(160),
    licenseNumber: z.string().trim().min(3).max(60),
    hospitalId: id,
    address: shortText(255),
    cityId: optionalId,
  }),
]);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone,
  address: shortText(255),
  cityId: optionalId,
  weightKg: z.coerce.number().min(20).max(300).optional().nullable(),
  medicalNotes: shortText(2000),
});
