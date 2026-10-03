import { inviteTokenSchema } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { hashInviteToken, newInvite } from './invites';

describe('invites', () => {
  it('makes a token for the link and keeps only its hash', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const invite = newInvite(now);
    expect(inviteTokenSchema.safeParse(invite.token).success).toBe(true);
    expect(invite.tokenHash).toBe(hashInviteToken(invite.token));
    expect(invite.tokenHash).not.toContain(invite.token);
    expect(invite.expiresAt.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(newInvite(now).token).not.toBe(invite.token);
  });
});
