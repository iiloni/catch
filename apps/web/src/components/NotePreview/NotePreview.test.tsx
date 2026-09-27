import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotePreview } from './NotePreview';

const text = (value: string, styles = {}) => ({ type: 'text', text: value, styles });

describe('NotePreview', () => {
  it('renders a leading heading as the title', () => {
    render(
      <NotePreview
        content={[
          { type: 'heading', content: [text('Groceries')] },
          { type: 'paragraph', content: [text('Oat milk')] },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.getByText('Oat milk')).toBeInTheDocument();
  });

  it('skips empty blocks and strikes through checked items', () => {
    render(
      <NotePreview
        content={[
          { type: 'heading', content: [] },
          { type: 'checkListItem', props: { checked: true }, content: [text('Done')] },
        ]}
      />,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Done').closest('p')).toHaveClass('line-through');
  });

  it('renders links and truncates long notes', () => {
    render(
      <NotePreview
        maxBlocks={1}
        content={[
          {
            type: 'paragraph',
            content: [{ type: 'link', href: 'https://example.com', content: [text('site')] }],
          },
          { type: 'paragraph', content: [text('hidden')] },
        ]}
      />,
    );
    expect(screen.getByText('site').closest('[data-href]')).toHaveAttribute(
      'data-href',
      'https://example.com',
    );
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
