import { createStore } from './store';

/**
 * Whether the page's header is glass pills (its title in the corner, or a selection's
 * toolbars) rather than the large title over flat controls. Toasts make room for the pills.
 */
export const headerPills = createStore(false);
