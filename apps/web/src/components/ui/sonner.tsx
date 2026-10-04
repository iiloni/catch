import { X } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Compact glass toasts. Each one closes from its X, or with a flick up or to either side
 * by finger or mouse. The layout overrides that size and center them are in `styles.css`.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      // The toasts are unstyled and our tokens follow the color scheme themselves. Sonner's
      // dark theme would still paint the close button and descriptions.
      theme="light"
      className="toaster group"
      closeButton
      swipeDirections={['top', 'left', 'right']}
      // Sonner only skips starting a swipe when the press lands on the button itself.
      // It also ignores a drag that selects text, hence `select-none` on the toast.
      icons={{ close: <X className="pointer-events-none size-4" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'glass flex min-h-10 cursor-grab select-none items-center font-sans gap-1 rounded-[1.25rem] py-1 pr-1 pl-4 text-foreground text-sm active:cursor-grabbing',
          content: 'min-w-0 py-1',
          title: 'font-medium',
          description: 'text-muted-foreground text-xs',
          actionButton:
            'h-8 shrink-0 cursor-pointer rounded-full px-3 font-semibold text-[color:var(--brand-link)] outline-none hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          closeButton:
            'order-last grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
