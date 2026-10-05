import { Capacitor } from '@capacitor/core';
import { currentPath, pagePath } from './auth';

const STORAGE_KEY = 'catch-home-page';

function isInstalledApp(): boolean {
  return (
    Capacitor.isNativePlatform() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Restore before creating the router so the first page is the saved view. */
export function restoreHomePage() {
  if (!isInstalledApp()) return;
  const { search, hash } = window.location;
  // A note, share, capture or other explicit destination takes precedence over the preference.
  if (currentPath() !== '/' || search || hash) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === '/deck') {
      window.history.replaceState(window.history.state, '', pagePath('/deck'));
    }
  } catch {
    // Storage may be unavailable; the default Gallery still works.
  }
}

export function rememberHomePage(pathname: string) {
  if (!isInstalledApp() || (pathname !== '/' && pathname !== '/deck')) return;
  try {
    localStorage.setItem(STORAGE_KEY, pathname);
  } catch {
    // A preference must not prevent navigation when storage is unavailable.
  }
}
