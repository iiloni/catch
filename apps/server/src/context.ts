import type { AuthSession } from './auth';

export type AppEnv = {
  Variables: {
    user: AuthSession['user'] | null;
    session: AuthSession['session'] | null;
  };
};
