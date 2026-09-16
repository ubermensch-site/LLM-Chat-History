export function stableSourceSessionId(
  contentSourceSessionId: string,
  tabId: number | undefined
): string {
  return Number.isInteger(tabId) && (tabId ?? -1) >= 0
    ? `tab:${tabId}`
    : contentSourceSessionId;
}
