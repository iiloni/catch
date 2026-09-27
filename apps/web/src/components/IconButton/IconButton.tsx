import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Props = React.ComponentProps<typeof Button> & {
  /** Accessible name, also shown as the tooltip. */
  label: string;
};

/** Icon-only button with a tooltip. Stops clicks from reaching a clickable card. */
export function IconButton({ label, className, onClick, ...props }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn('size-8 rounded-full', className)}
          onClick={(event) => {
            event.stopPropagation();
            onClick?.(event);
          }}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
