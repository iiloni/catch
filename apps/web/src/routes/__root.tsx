import { createRootRoute, type ErrorComponentProps, Outlet } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useApplyTheme } from '@/lib/theme';

export const Route = createRootRoute({
  component: Root,
  errorComponent: RootError,
});

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="font-bold text-2xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}

function Root() {
  useApplyTheme();
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster position="bottom-left" />
    </TooltipProvider>
  );
}
