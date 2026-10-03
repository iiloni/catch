import { z } from 'zod';

/** Sign-up sends an invite's token in this header; the server takes one in place of open registration. */
export const INVITE_HEADER = 'X-Catch-Invite';

/** How long an invite can be used for after it is made. */
export const INVITE_DAYS = 7;

export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * One account's worth of sign-up, made by an admin and handed over as a link. The token is
 * only in that link: the server keeps its hash, so nobody reads a usable invite out of it.
 */
export const inviteSchema = z.object({
  id: z.uuid(),
  /** Who the admin made it for, to tell invites apart. Nothing checks it against the account. */
  label: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
  /** The account it made, while that account exists. */
  usedBy: z.object({ name: z.string(), email: z.string() }).nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const invitesResponseSchema = z.object({ invites: z.array(inviteSchema) });
export type InvitesResponse = z.infer<typeof invitesResponseSchema>;

export const createInviteSchema = z.object({ label: z.string().trim().max(100).default('') });
export type CreateInvite = z.input<typeof createInviteSchema>;

/** The only response that carries the token. */
export const createInviteResponseSchema = z.object({
  invite: inviteSchema,
  token: inviteTokenSchema,
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

/** The link an invited person opens. The token rides in the fragment, which servers do not log. */
export function inviteLink(serverUrl: string, token: string) {
  return `${new URL('/login', serverUrl).href}#invite=${token}`;
}

/** The token in a sign-in page's fragment, when it was opened from an invite link. */
export function inviteFromFragment(fragment: string): string | null {
  const value = /(?:^#?|&)invite=([^&]*)/.exec(fragment)?.[1];
  const parsed = inviteTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
