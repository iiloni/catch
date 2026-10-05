import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/figtree';
import { Capacitor } from '@capacitor/core';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { basePath } from './lib/auth';
import { pageTransition } from './lib/dockState';
import { rememberHomePage, restoreHomePage } from './lib/homePage';
import { startKeyboardTracking } from './lib/keyboard';
import { keepScrollAcrossNotes } from './lib/openNote';
import { initializeWebUpdates } from './lib/webUpdates';
import { routeTree } from './routeTree.gen';
import './styles.css';

document.documentElement.dataset.platform = Capacitor.getPlatform();
restoreHomePage();

const router = createRouter({
  routeTree,
  // A page of one of several accounts is at `/u/<number>/…` (ADR 0019); routes never say so.
  basepath: basePath || undefined,
  // Pages slide in the direction of travel (see the view transition styles in styles.css).
  // Without transition types the router would cross-fade every navigation, opening notes too.
  defaultViewTransition: CSS.supports('selector(:active-view-transition-type(a))')
    ? {
        types: ({ fromLocation, toLocation }) =>
          pageTransition(fromLocation?.pathname, toLocation.pathname),
      }
    : false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

keepScrollAcrossNotes(router);
router.subscribe('onResolved', ({ toLocation }) => rememberHomePage(toLocation.pathname));
startKeyboardTracking();
initializeWebUpdates();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
