import { attachmentUrl } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { noteMarkdown } from './noteMarkdown';

describe('noteMarkdown', () => {
  it('exports headings, formatting, links, checked tasks and nested lists', () => {
    const markdown = noteMarkdown([
      { type: 'heading', props: { level: 3 }, content: 'Trip plan' },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Pack ', styles: {} },
          { type: 'text', text: 'light', styles: { bold: true } },
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: 'Guide', styles: {} }],
          },
        ],
      },
      { type: 'checkListItem', props: { checked: true }, content: 'Tent' },
      {
        type: 'bulletListItem',
        content: 'Food',
        children: [{ type: 'bulletListItem', content: 'Snacks' }],
      },
    ]);
    expect(markdown).toContain('### Trip plan');
    expect(markdown).toContain('**light**');
    expect(markdown).toContain('[Guide](https://example.com)');
    expect(markdown).toContain('[x] Tent');
    expect(markdown).toMatch(/\n\s+[-*] Snacks/);
  });

  it('exports fenced code and replaces private attachment references with their name', () => {
    const markdown = noteMarkdown([
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'const x = 1;' },
      {
        type: 'file',
        props: { url: attachmentUrl('0199a0a0-0000-7000-8000-000000000001'), name: 'tickets.pdf' },
      },
    ]);
    expect(markdown).toContain('```javascript');
    expect(markdown).toContain('const x = 1;');
    expect(markdown).toContain('tickets.pdf');
    expect(markdown).not.toContain('attachment:');
  });

  it('exports an empty note as empty text', () => {
    expect(noteMarkdown([])).toBe('');
  });
});
