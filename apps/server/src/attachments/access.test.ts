import { describe, expect, it } from 'vitest';
import { issueAccess, readAccess } from './access';

describe('attachment access', () => {
  const id = '0199a0a0-0000-7000-8000-000000000001';
  it('limits a ticket to its user, attachment and expiry', () => {
    const ticket = issueAccess('user-a', id, 1000);
    expect(readAccess(ticket, id, 1000)).toBe('user-a');
    expect(readAccess(ticket, '0199a0a0-0000-7000-8000-000000000002', 1000)).toBeNull();
    expect(readAccess(ticket, id, 1000 + 60 * 60 * 1000)).toBeNull();
    expect(readAccess(`x${ticket}`, id, 1000)).toBeNull();
    expect(readAccess(`${ticket}.extra`, id, 1000)).toBeNull();
  });
});
