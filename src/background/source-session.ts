export function stableSourceSessionId(
  contentSourceSessionId: string,
  tabId: number | undefined
): string {
  return Number.isInteger(tabId) && (tabId ?? -1) >= 0
    ? `tab:${tabId}`
    : contentSourceSessionId;
}

function stableChatConversationId(urlValue: string | undefined): string | null {
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    if (url.hostname !== 'chatgpt.com' && url.hostname !== 'www.chatgpt.com') return null;
    const match = /^\/c\/([^/?#]+)/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * A document being replaced can still deliver a queued provisional observation
 * after ChatGPT has already navigated the browser tab to /c/<stable-id>.
 * MessageSender.tab is the browser's current tab state, while pageUrl is the
 * sending document's observed route. Reject only that narrow mismatch: a
 * provisional document cannot recreate an archive once the tab is currently on
 * a stable conversation route.
 */
export function shouldRejectSupersededProvisional(
  providerConversationId: string | null,
  messagePageUrl: string,
  currentTabUrl: string | undefined
): boolean {
  if (providerConversationId !== null) return false;
  if (stableChatConversationId(messagePageUrl) !== null) return false;
  return stableChatConversationId(currentTabUrl) !== null;
}
