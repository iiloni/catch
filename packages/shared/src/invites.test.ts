import { describe, expect, it } from 'vitest';
import { inviteFromFragment, inviteLink } from './invites';

const token = 'aB3_-'.repeat(8) + 'xyz';

describe('invite links', () => {
  it('carry the token in the fragment and give it back', () => {
    const link = inviteLink('https://catch.example.com', token);
    expect(link).toBe(`https://catch.example.com/login#invite=${token}`);
    expect(inviteFromFragment(new URL(link).hash)).toBe(token);
  });

  it('find no token in other fragments', () => {
    for (const fragment of [
      '',
      '#',
      '#invite=',
      '#invite=short',
      '#url=https%3A%2F%2Fexample.com',
    ]) {
      expect(inviteFromFragment(fragment), fragment).toBeNull();
    }
  });
});
