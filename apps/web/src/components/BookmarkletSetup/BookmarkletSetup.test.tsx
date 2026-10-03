import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BookmarkletSetup } from './BookmarkletSetup';

vi.mock('@/lib/serverUrl', () => ({ getServerUrl: () => 'https://catch.example/' }));

it('offers an installable bookmarklet and copies the same code without running it in Settings', async () => {
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true });
  render(<BookmarkletSetup />);
  const anchor = screen.getByRole('link', { name: 'Save to Catch' });
  const code = anchor.getAttribute('href');
  expect(code).toMatch(/^javascript:/);
  expect(code).toContain('https://catch.example/capture');
  expect(anchor).toHaveAttribute('draggable', 'true');
  expect(fireEvent.click(anchor)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Copy bookmarklet' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(code));
});
