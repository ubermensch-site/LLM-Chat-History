import { describe, expect, it } from 'vitest';
import { findTextRanges } from './conversation-find';

describe('conversation find', () => {
  it('finds case-insensitive non-overlapping ranges', () => {
    expect(findTextRanges('Alpha beta ALPHA', 'alpha')).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 }
    ]);
  });

  it('returns no matches for an empty query', () => {
    expect(findTextRanges('anything', '   ')).toEqual([]);
  });

  it('handles repeated adjacent matches deterministically', () => {
    expect(findTextRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ]);
  });
});
