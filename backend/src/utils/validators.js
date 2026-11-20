import { z } from 'zod';

/*
 * Free text a shopper types is bounded at the lengths the forms allow: the address fields as in
 * src/store/addressModel.ts (ADDRESS_MAX_LENGTH), names and phone as the sign-up and profile fields' maxLength.
 */
const firstName = z.string().min(2, 'First name must be at least 2 characters').max(100, 'First name must be at most 100 characters');
const lastName = z.string().min(2, 'Last name must be at least 2 characters').max(100, 'Last name must be at most 100 characters');
const phone = z.string().max(20, 'Phone must be at most 20 characters');

// Auth schemas
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName,
  lastName,
  phone: phone.optional(),
  /** The sign-up box "I would like to receive promotional emails"; unticked means not asked, not an opt-out. */
  promotionalEmails: z.boolean().default(false),
});

/** A profile change: only the fields sent change. Names and phone keep the limits above, but no new minimums. */
export const profileSchema = z.object({
  firstName: z.string().max(100, 'First name must be at most 100 characters').optional(),
  lastName: z.string().max(100, 'Last name must be at most 100 characters').optional(),
  phone: phone.nullable().optional(),
  profileImage: z.string().nullable().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// Address schemas
export const addressSchema = z.object({
  street: z.string().min(5, 'Street address must be at least 5 characters').max(200, 'Street address must be at most 200 characters'),
  city: z.string().min(2, 'City must be at least 2 characters').max(100, 'City must be at most 100 characters'),
  county: z.string().min(2, 'County must be at least 2 characters').max(100, 'County must be at most 100 characters'),
  postalCode: z.string().max(20, 'Postal code must be at most 20 characters').optional(),
  isDefault: z.boolean().optional(),
});
