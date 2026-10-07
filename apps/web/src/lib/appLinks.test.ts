import { describe, expect, it } from 'vitest';
import { openInAppLink, parseAppLink } from './appLinks';

const token = 'A'.repeat(43);
const server = 'https://catch.example';
const address = (link: string) => `catchnotes://open?${new URLSearchParams({ link })}`;

describe('openInAppLink', () => {
  it('wraps a link in an address the app reads back', () => {
    const link = `${server}/s/${token}`;
    const intent = openInAppLink(link);
    expect(intent).toMatch(/^intent:\/\/open\?link=.+#Intent;scheme=catchnotes;end$/);
    // Android drops the fragment and puts the scheme in place of `intent`.
    const opened = intent.replace(/^intent:/, 'catchnotes:').replace(/#.*$/, '');
    expect(parseAppLink(opened, server)).toEqual({ kind: 'share', token });
  });
});

describe('parseAppLink', () => {
  it('reads the token of a share link on the connected server', () => {
    expect(parseAppLink(address(`${server}/s/${token}`), server)).toEqual({ kind: 'share', token });
    expect(parseAppLink(address(`${server}/s/${token}`), `${server}/`)).toEqual({
      kind: 'share',
      token,
    });
  });

  it('takes the link as it is before the app has a server', () => {
    expect(parseAppLink(address(`${server}/s/${token}`), '')).toEqual({ kind: 'share', token });
  });

  it('says when the note is on another server', () => {
    expect(parseAppLink(address(`https://other.example/s/${token}`), server)).toEqual({
      kind: 'elsewhere',
      host: 'other.example',
    });
  });

  it('ignores anything that is not a share link', () => {
    for (const value of [
      `${server}/s/${token}`,
      `other://open?link=${server}/s/${token}`,
      `catchnotes://elsewhere?link=${server}/s/${token}`,
      'catchnotes://open',
      address('not a link'),
      address(`javascript:alert(1)//s/${token}`),
      address(`${server}/s/short`),
      address(`${server}/s/${token}/extra`),
      address(`${server}/settings/${token}`),
      address(`${server}/sx/${token}`),
    ])
      expect(parseAppLink(value, server)).toBeNull();
  });
});
