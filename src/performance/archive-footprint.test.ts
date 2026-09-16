import { describe, expect, it } from 'vitest';
import type {
  ArchiveConversation,
  ArchiveEvent,
  ArchiveMessage,
  ArchiveProject
} from '../storage/schema';
import { calculateArchiveFootprint } from './archive-footprint';

function conversation(): ArchiveConversation {
  return {
    id: 'conv:chatgpt:profile',
    providerId: 'chatgpt',
    providerConversationId: 'profile',
    providerKey: 'chatgpt:profile',
    provisional: false,
    sourceUrl: 'https://chatgpt.com/c/profile',
    title: 'Profile test',
    createdAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T11:00:00.000Z',
    lastObservedAt: '2026-09-16T11:00:00.000Z',
    messageCount: 0,
    recordingState: 'recording',
    recordingStateUpdatedAt: '2026-09-16T11:00:00.000Z'
  };
}

function message(index: number): ArchiveMessage {
  const plainText = `turn-${index}-π`;
  return {
    id: `conv:chatgpt:profile:turn:${index}`,
    conversationId: 'conv:chatgpt:profile',
    providerId: 'chatgpt',
    providerTurnId: String(index),
    providerMessageId: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    orderHint: index,
    plainText,
    markdown: `**${plainText}**`,
    partial: false,
    contentHash: `hash-${index}`,
    firstObservedAt: '2026-09-16T11:00:00.000Z',
    lastObservedAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T11:00:00.000Z'
  };
}

const project: ArchiveProject = {
  id: 'project:profile',
  name: 'Profile',
  folders: [],
  createdAt: '2026-09-16T11:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z'
};

const healthEvent: ArchiveEvent = {
  id: 'event:health',
  conversationId: null,
  type: 'adapter-health',
  createdAt: '2026-09-16T11:00:00.000Z',
  data: { providerId: 'chatgpt', state: 'healthy', code: 'adapter-ready' }
};

describe('archive footprint profiling', () => {
  it('returns only aggregate counts and byte totals', () => {
    const messages = [message(0), message(1)];
    const footprint = calculateArchiveFootprint({
      conversations: [conversation()],
      messages,
      events: [healthEvent],
      projects: [project]
    });

    expect(footprint.conversations.count).toBe(1);
    expect(footprint.messages.count).toBe(2);
    expect(footprint.events.count).toBe(1);
    expect(footprint.projects.count).toBe(1);
    expect(footprint.totalRecords).toBe(5);
    expect(footprint.estimatedJsonBytes).toBeGreaterThan(footprint.messageTextBytes);
    expect(JSON.stringify(footprint)).not.toContain('Profile test');
    expect(JSON.stringify(footprint)).not.toContain('turn-0');
  });

  it('profiles a large synthetic archive deterministically', () => {
    const messages = Array.from({ length: 10_000 }, (_, index) => message(index));
    const first = calculateArchiveFootprint({
      conversations: [{ ...conversation(), messageCount: messages.length }],
      messages,
      events: [healthEvent],
      projects: [project]
    });
    const second = calculateArchiveFootprint({
      conversations: [{ ...conversation(), messageCount: messages.length }],
      messages,
      events: [healthEvent],
      projects: [project]
    });

    expect(first).toEqual(second);
    expect(first.messages.count).toBe(10_000);
    expect(first.totalRecords).toBe(10_003);
    expect(first.messageTextBytes).toBeGreaterThan(100_000);
    expect(first.estimatedJsonBytes).toBeGreaterThan(first.messageTextBytes);
  });
});
