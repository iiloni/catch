import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/figtree';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startKeyboardTracking } from './lib/keyboard';
import { routeTree } from './routeTree.gen';
import './styles.css';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

startKeyboardTracking();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
