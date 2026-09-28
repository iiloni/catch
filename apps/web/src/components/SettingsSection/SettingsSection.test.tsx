import { render, screen } from '@testing-library/react';
import { Server } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { SettingsRow, SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  it('names its region after its title and lays out rows', () => {
    render(
      <SettingsSection title="Connection" description="Where your notes sync.">
        <SettingsRow icon={Server} label="Server" description="https://notes.example.com">
          <button type="button">Change</button>
        </SettingsRow>
      </SettingsSection>,
    );
    const region = screen.getByRole('region', { name: 'Connection' });
    expect(region).toHaveTextContent('Server');
    expect(region).toHaveTextContent('https://notes.example.com');
    expect(region).toHaveTextContent('Where your notes sync.');
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });
});
