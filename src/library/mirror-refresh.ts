import type { BackgroundAck, RefreshMirrorMessage } from '../shared/types';

export async function requestMirrorRefresh(conversationId: string): Promise<void> {
  const message: RefreshMirrorMessage = {
    type: 'LLMCH_REFRESH_MIRROR',
    conversationId
  };
  try {
    const ack = (await chrome.runtime.sendMessage(message)) as BackgroundAck | undefined;
    if (!ack?.ok) {
      console.warn('[LLM Chat History] mirror refresh request was not acknowledged', ack?.error);
    }
  } catch (error) {
    console.warn('[LLM Chat History] mirror refresh request failed', error);
  }
}

export function requestMirrorRefreshes(conversationIds: Iterable<string>): void {
  for (const conversationId of new Set(conversationIds)) {
    void requestMirrorRefresh(conversationId);
  }
}
