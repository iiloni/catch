import { z } from 'zod';

export const userRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const adminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersSchema = z.object({
  search: z.string().trim().max(200).default(''),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListUsers = z.infer<typeof listUsersSchema>;

export const usersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  total: z.number().int().min(0),
});
export type UsersResponse = z.infer<typeof usersResponseSchema>;

export const updateUserRoleSchema = z.object({ role: userRoleSchema }).strict();
export type UpdateUserRole = z.infer<typeof updateUserRoleSchema>;

export const resetUserPasswordResponseSchema = z.object({
  temporaryPassword: z.string().min(8).max(128),
});
export type ResetUserPasswordResponse = z.infer<typeof resetUserPasswordResponseSchema>;

export const userActionResponseSchema = z.object({ ok: z.literal(true) });
export type UserActionResponse = z.infer<typeof userActionResponseSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});
