import { describe, expect, it } from 'vitest';
import { clampRecorderPosition, normalizeRecorderPosition } from './recorder-position';

describe('recorder position', () => {
  it('accepts finite saved coordinates only', () => {
    expect(normalizeRecorderPosition({ x: 120, y: 240 })).toEqual({ x: 120, y: 240 });
    expect(normalizeRecorderPosition({ x: Number.NaN, y: 10 })).toBeNull();
    expect(normalizeRecorderPosition({ x: 10, y: '20' })).toBeNull();
    expect(normalizeRecorderPosition(null)).toBeNull();
  });

  it('keeps the recorder inside the visible browser area', () => {
    expect(clampRecorderPosition({ x: -50, y: -10 }, 200, 100, 1000, 700)).toEqual({
      x: 8,
      y: 8
    });
    expect(clampRecorderPosition({ x: 950, y: 680 }, 200, 100, 1000, 700)).toEqual({
      x: 792,
      y: 592
    });
    expect(clampRecorderPosition({ x: 120, y: 180 }, 200, 100, 1000, 700)).toEqual({
      x: 120,
      y: 180
    });
  });

  it('still returns an on-screen anchor when the recorder is larger than the viewport', () => {
    expect(clampRecorderPosition({ x: 300, y: 300 }, 900, 700, 600, 500)).toEqual({
      x: 8,
      y: 8
    });
  });
});
