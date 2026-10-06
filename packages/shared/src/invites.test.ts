import { describe, expect, it } from 'vitest';
import { inviteFromFragment, inviteFromText, inviteLink } from './invites';

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

  it('read a pasted link or a token alone', () => {
    expect(inviteFromText(` ${inviteLink('https://catch.example.com', token)}\n`)).toBe(token);
    expect(inviteFromText(token)).toBe(token);
    for (const text of ['', 'https://catch.example.com', 'https://catch.example.com/login#x']) {
      expect(inviteFromText(text), text).toBeNull();
    }
  });
});
