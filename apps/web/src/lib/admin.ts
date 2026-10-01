import { userRoleSchema } from '@catch/shared';
import { z } from 'zod';
import { authClient } from './auth';

const adminSessionUserSchema = z.object({ role: userRoleSchema });

export function hasAdminRole(user: unknown) {
  const parsed = adminSessionUserSchema.safeParse(user);
  return parsed.success && parsed.data.role === 'admin';
}

export function useAdminAccess() {
  const { data, error } = authClient.useSession();
  return !error && hasAdminRole(data?.user);
}
