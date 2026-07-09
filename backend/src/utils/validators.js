import { z } from 'zod';

// Auth schemas
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  phone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// Product schemas
export const productSchema = z.object({
  name: z.string().min(3, 'Product name must be at least 3 characters'),
  price: z.number().positive('Price must be positive'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  categoryId: z.string().min(1, 'Category is required'),
  designerId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

export const updateProductSchema = productSchema.partial();

// Category schemas
export const categorySchema = z.object({
  name: z.string().min(2, 'Category name must be at least 2 characters'),
  headerImage: z.string().url().optional(),
  order: z.number().optional(),
});

// Designer schemas
export const designerSchema = z.object({
  designerId: z.string().min(1, 'Designer ID is required'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  specialty: z.string().min(2, 'Specialty must be at least 2 characters'),
  location: z.string().optional(),
  profileImage: z.string().url().optional(),
  spotlightHeading: z.string().optional(),
  spotlightText: z.string().optional(),
});

// Address schemas
export const addressSchema = z.object({
  street: z.string().min(5, 'Street address must be at least 5 characters'),
  city: z.string().min(2, 'City must be at least 2 characters'),
  county: z.string().min(2, 'County must be at least 2 characters'),
  postalCode: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// Discount schemas
export const discountSchema = z.object({
  name: z.string().min(2, 'Discount name must be at least 2 characters'),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().positive('Value must be positive'),
  applyTo: z.enum(['ALL', 'CATEGORY', 'SELECTED']),
  targetIds: z.array(z.string()).optional(),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()).optional(),
  isActive: z.boolean().optional(),
});

// Stock schemas
export const stockSchema = z.object({
  quantity: z.number().int().min(0, 'Quantity must be non-negative'),
  maxStock: z.number().int().positive('Max stock must be positive').optional(),
  minThreshold: z.number().int().min(0, 'Min threshold must be non-negative').optional(),
});
