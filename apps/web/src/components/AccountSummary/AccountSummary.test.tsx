import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountSummary, initials } from './AccountSummary';

describe('initials', () => {
  it('takes the first letters of up to two names, or of the email', () => {
    expect(initials('ada lovelace byron', 'ada@example.com')).toBe('AL');
    expect(initials('  ', 'ada@example.com')).toBe('A');
  });
});

describe('AccountSummary', () => {
  it('shows the name with the email under it', () => {
    render(<AccountSummary name="Ada" email="ada@example.com" />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('shows the email alone when there is no name', () => {
    render(<AccountSummary name="" email="ada@example.com" />);
    expect(screen.getAllByText('ada@example.com')).toHaveLength(1);
  });
});
