import { createStore } from './store';

/** External taps have no on-screen card to grow from. */
export const widgetNoteOpening = createStore<string | null>(null);
/** Flush editors before leaving the vault or changing the widget's account. */
export const beforeWidgetOpen = new Set<() => void | Promise<void>>();
