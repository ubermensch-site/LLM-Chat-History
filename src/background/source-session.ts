export function stableSourceSessionId(
  contentSourceSessionId: string,
  tabId: number | undefined
): string {
  return Number.isInteger(tabId) && (tabId ?? -1) >= 0
    ? `tab:${tabId}`
    : contentSourceSessionId;
}

export function stableChatConversationIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[0] === 'c' && Boolean(segments[1]) ? segments[1]! : null;
  } catch {
    return null;
  }
}

export function isStaleProvisionalObservationForCurrentTab(
  providerConversationId: string | null,
  currentTabUrl: string | undefined
): boolean {
  return providerConversationId === null && stableChatConversationIdFromUrl(currentTabUrl) !== null;
}
