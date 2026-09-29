import { describe, expect, it } from 'vitest';
import { decodeHtml, parseHtml } from './parseHtml';

const page = (head: string) =>
  `<!doctype html><html><head>${head}</head><body><p>x</p></body></html>`;

describe('parseHtml', () => {
  it('prefers Open Graph tags and resolves URLs against the page', () => {
    const meta = parseHtml(
      page(`
        <title>Fallback title</title>
        <meta property="og:title" content="The &amp; Title">
        <meta property="og:description" content='Line one
          line two'>
        <meta property="og:site_name" content="Example">
        <meta property="og:image" content="/img/card.png">
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000">
        <meta name="theme-color" content="#ff5500">
      `),
      'https://example.com/post/1',
    );
    expect(meta).toMatchObject({
      title: 'The & Title',
      description: 'Line one line two',
      siteName: 'Example',
      image: 'https://example.com/img/card.png',
      themeColor: '#ff5500',
    });
  });

  it('falls back to the title tag and the default favicon', () => {
    const meta = parseHtml(page('<title> Plain &#8211; page </title>'), 'https://a.example/x');
    expect(meta.title).toBe('Plain – page');
    expect(meta.image).toBeNull();
    expect(meta.icons).toEqual(['https://a.example/favicon.ico']);
  });

  it('ranks touch icons and SVGs over small favicons', () => {
    const meta = parseHtml(
      page(`
        <link rel="icon" href="/16.png" sizes="16x16">
        <link rel="apple-touch-icon" href="/touch.png">
        <link rel="icon" href="/logo.svg" type="image/svg+xml">
        <link rel="mask-icon" href="/mask.svg">
      `),
      'https://a.example/',
    );
    expect(meta.icons).toEqual([
      'https://a.example/touch.png',
      'https://a.example/logo.svg',
      'https://a.example/16.png',
      'https://a.example/favicon.ico',
    ]);
  });

  it('ignores tags in the body, comments and non-web URLs', () => {
    const meta = parseHtml(
      `<head><!-- <meta property="og:title" content="commented"> -->
       <meta property="og:image" content="javascript:alert(1)"></head>
       <body><meta property="og:title" content="in body"></body>`,
      'https://a.example/',
    );
    expect(meta.title).toBeNull();
    expect(meta.image).toBeNull();
  });

  it('reads attributes that contain a closing angle bracket', () => {
    const meta = parseHtml(
      page('<meta property="og:title" content="a > b">'),
      'https://a.example/',
    );
    expect(meta.title).toBe('a > b');
  });
});

describe('decodeHtml', () => {
  it('honours the declared charset', () => {
    const body = Buffer.from('<meta charset="iso-8859-1"><title>caf\xe9</title>', 'latin1');
    expect(decodeHtml('text/html', body)).toContain('café');
  });
});
