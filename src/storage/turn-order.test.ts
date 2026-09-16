import { describe, expect, it } from 'vitest';
import { reconcileObservedTurnOrder } from './turn-order';

describe('reconcileObservedTurnOrder', () => {
  it('prepends older turns from an overlapping virtualized window', () => {
    expect(
      reconcileObservedTurnOrder(
        ['turn-4', 'turn-5', 'turn-6'],
        ['turn-2', 'turn-3', 'turn-4', 'turn-5']
      )
    ).toEqual(['turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6']);
  });

  it('inserts unseen turns between known anchors', () => {
    expect(
      reconcileObservedTurnOrder(
        ['turn-0', 'turn-1', 'turn-4', 'turn-5'],
        ['turn-1', 'turn-2', 'turn-3', 'turn-4']
      )
    ).toEqual(['turn-0', 'turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5']);
  });

  it('appends newer turns after the last visible known anchor', () => {
    expect(
      reconcileObservedTurnOrder(
        ['turn-0', 'turn-1', 'turn-2'],
        ['turn-1', 'turn-2', 'turn-3', 'turn-4']
      )
    ).toEqual(['turn-0', 'turn-1', 'turn-2', 'turn-3', 'turn-4']);
  });

  it('deduplicates repeated observer IDs without disturbing canonical order', () => {
    expect(
      reconcileObservedTurnOrder(
        ['turn-0', 'turn-1', 'turn-2'],
        ['turn-1', 'turn-1', 'turn-2', 'turn-2']
      )
    ).toEqual(['turn-0', 'turn-1', 'turn-2']);
  });

  it('does not reorder known history for an unanchored disjoint window', () => {
    expect(
      reconcileObservedTurnOrder(['turn-0', 'turn-1'], ['turn-8', 'turn-9'])
    ).toEqual(['turn-0', 'turn-1', 'turn-8', 'turn-9']);
  });
});
