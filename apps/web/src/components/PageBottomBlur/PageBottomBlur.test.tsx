import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PageBottomBlur } from './PageBottomBlur';

const scrollingElement = Object.getOwnPropertyDescriptor(document, 'scrollingElement');

afterEach(() => {
  if (scrollingElement) Object.defineProperty(document, 'scrollingElement', scrollingElement);
  else Reflect.deleteProperty(document, 'scrollingElement');
  vi.unstubAllGlobals();
});

it('fades out at the bottom and responds when page content grows', () => {
  let scrollTop = 0;
  let scrollHeight = 1000;
  let onResize: ResizeObserverCallback = () => {};
  Object.defineProperty(document, 'scrollingElement', {
    configurable: true,
    value: {
      get scrollTop() {
        return scrollTop;
      },
      clientHeight: 600,
      get scrollHeight() {
        return scrollHeight;
      },
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );

  const { container } = render(<PageBottomBlur />);
  const blur = container.firstElementChild as HTMLElement;
  expect(blur.style.opacity).toBe('1');

  scrollTop = 400;
  fireEvent.scroll(window);
  expect(blur.style.opacity).toBe('0');

  scrollHeight = 1200;
  act(() => onResize([], {} as ResizeObserver));
  expect(blur.style.opacity).toBe('1');
});
