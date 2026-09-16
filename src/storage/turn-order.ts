function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Merge one rendered DOM window into the canonical turn order without treating
 * window-local indexes as absolute conversation positions.
 *
 * Existing IDs keep their relative order. New IDs are inserted relative to the
 * nearest already-known visible anchors. This makes overlapping virtualized
 * windows converge as the user scrolls older/newer history into the DOM.
 */
export function reconcileObservedTurnOrder(
  existingOrder: readonly string[],
  observedWindow: readonly string[]
): string[] {
  const order = unique(existingOrder);
  const windowIds = unique(observedWindow);
  if (!windowIds.length) return order;
  if (!order.length) return windowIds;

  for (let windowIndex = 0; windowIndex < windowIds.length; windowIndex += 1) {
    const id = windowIds[windowIndex]!;
    if (order.includes(id)) continue;

    let leftId: string | undefined;
    for (let index = windowIndex - 1; index >= 0; index -= 1) {
      const candidate = windowIds[index]!;
      if (order.includes(candidate)) {
        leftId = candidate;
        break;
      }
    }

    let rightId: string | undefined;
    for (let index = windowIndex + 1; index < windowIds.length; index += 1) {
      const candidate = windowIds[index]!;
      if (order.includes(candidate)) {
        rightId = candidate;
        break;
      }
    }

    if (leftId) {
      const leftIndex = order.indexOf(leftId);
      const rightIndex = rightId ? order.indexOf(rightId) : -1;
      const insertionIndex = rightIndex > leftIndex ? rightIndex : leftIndex + 1;
      order.splice(insertionIndex, 0, id);
      continue;
    }

    if (rightId) {
      order.splice(order.indexOf(rightId), 0, id);
      continue;
    }

    // A completely disjoint window has no reliable positional anchor. Append it
    // rather than reordering already-canonical history. Normal ChatGPT virtualized
    // scrolling is expected to expose overlapping windows, which this function
    // reconciles exactly.
    order.push(id);
  }

  return order;
}
