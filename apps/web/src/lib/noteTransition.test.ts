import { describe, expect, it } from 'vitest';
import { morphOpacity } from './noteTransition';

const steps = Array.from({ length: 101 }, (_, index) => index / 100);
const shown = (progress: number, hasImage: boolean) => {
  const { face, content } = morphOpacity(progress, hasImage);
  return 1 - (1 - face) * (1 - content);
};

describe('morphOpacity', () => {
  it('starts on the card and ends on the note', () => {
    for (const hasImage of [true, false]) {
      expect(morphOpacity(0, hasImage)).toEqual({ face: 1, content: 0 });
      expect(morphOpacity(1, hasImage)).toEqual({ face: 0, content: 1 });
    }
  });

  it('never lets a note with an image blink out between the card and the editor', () => {
    expect(Math.min(...steps.map((progress) => shown(progress, true)))).toBeGreaterThan(0.9);
  });

  it('fades text through the note color rather than double-exposing it', () => {
    expect(Math.min(...steps.map((progress) => shown(progress, false)))).toBeLessThan(0.3);
  });
});
