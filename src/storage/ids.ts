import type { ProviderId } from '../shared/types';

export function providerConversationKey(
  providerId: ProviderId,
  providerConversationId: string
): string {
  return `${providerId}:${providerConversationId}`;
}

export function provisionalConversationKey(
  providerId: ProviderId,
  sourceSessionId: string
): string {
  return `${providerId}:${sourceSessionId}`;
}

export function newConversationId(providerId: ProviderId): string {
  return `conv:${providerId}:${crypto.randomUUID()}`;
}

export function messageId(conversationId: string, providerTurnId: string): string {
  return `${conversationId}:turn:${encodeURIComponent(providerTurnId)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
