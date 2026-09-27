import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useResolvedTheme } from '@/lib/theme';

function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
