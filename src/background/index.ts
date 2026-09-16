import type { ContentToBackgroundMessage } from '../shared/types';

chrome.runtime.onInstalled.addListener(() => {
  console.info('[LLM Chat History] extension installed');
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== 'object') return;

  const candidate = message as Partial<ContentToBackgroundMessage>;
  if (candidate.type !== 'LLMCH_PROVIDER_OBSERVATION' || !candidate.observation) return;

  // TASK-011/014 will replace this diagnostic bridge with durable IndexedDB writes.
  // Keeping the service worker stateless here is deliberate because MV3 workers suspend.
  console.debug('[LLM Chat History] provider observation', {
    tabId: sender.tab?.id,
    observation: candidate.observation
  });
});
