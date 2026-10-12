import { beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  ready: vi.fn<() => Promise<void>>(),
  show: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: native.platform },
  registerPlugin: () => native,
}));

import { focusWidgetInput } from './widgetInputFocus';

beforeEach(() => {
  vi.clearAllMocks();
  native.platform.mockReturnValue('android');
  native.ready.mockResolvedValue();
});

it('refocuses a mounted field after the cold Android window is ready, then requests IME', async () => {
  let ready = () => {};
  native.ready.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const focus = vi.fn();
  const finish = vi.fn();
  focusWidgetInput(focus, finish);
  expect(focus).toHaveBeenCalledOnce();
  expect(native.show).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(focus).toHaveBeenCalledTimes(2);
  expect(native.show).toHaveBeenCalledOnce();
  expect(focus.mock.invocationCallOrder[1]).toBeLessThan(
    native.show.mock.invocationCallOrder[0] ?? 0,
  );
});

it('does not refocus or reopen IME if the destination closes while the window is starting', async () => {
  let ready = () => {};
  native.ready.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const focus = vi.fn();
  const finish = vi.fn();
  const cancel = focusWidgetInput(focus, finish);
  cancel();
  ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(focus).toHaveBeenCalledOnce();
  expect(native.show).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});

it('leaves a cancelled StrictMode request available for the replacement effect', async () => {
  let ready = () => {};
  native.ready.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const finish = vi.fn();
  focusWidgetInput(vi.fn(), finish)();
  const focus = vi.fn();
  focusWidgetInput(focus, finish);
  ready();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(focus).toHaveBeenCalledTimes(2);
  expect(native.show).toHaveBeenCalledOnce();
});

it('focuses normally on the web without calling a native plugin', () => {
  native.platform.mockReturnValue('web');
  const focus = vi.fn();
  const finish = vi.fn();
  focusWidgetInput(focus, finish);
  expect(focus).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledOnce();
  expect(native.ready).not.toHaveBeenCalled();
});
