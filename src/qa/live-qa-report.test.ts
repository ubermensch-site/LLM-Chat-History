import { describe, expect, it } from 'vitest';
import {
  buildLiveQaReport,
  collectChatGptLiveQaDomEvidence,
  renderLiveQaReportJson,
  summarizeChatGptRoute
} from './live-qa-report';

describe('live QA report', () => {
  it('summarizes route structure without retaining raw conversation ids or query values', () => {
    const secretId = 'super-secret-conversation-id';
    const secretToken = 'private-query-token';
    const route = summarizeChatGptRoute(
      new URL(`https://chatgpt.com/c/${secretId}?token=${secretToken}#private`),
      true,
      false
    );

    expect(route).toEqual({
      kind: 'conversation',
      pathSegmentCount: 2,
      queryPresent: true,
      hashPresent: true,
      providerConversationIdPresent: true,
      provisional: false
    });
    expect(JSON.stringify(route)).not.toContain(secretId);
    expect(JSON.stringify(route)).not.toContain(secretToken);
  });

  it('collects selector counts without reading element text content', () => {
    const secretText = 'DO-NOT-EXPORT-MESSAGE-CONTENT';
    const counts = new Map<string, number>([
      ['section[data-turn="user"]', 2],
      ['section[data-turn="assistant"]', 2],
      ['article[data-turn]', 4],
      ['[data-message-author-role="user"]', 2],
      ['[data-message-author-role="assistant"]', 2],
      ['[data-role="user"]', 2],
      ['[data-role="assistant"]', 2],
      ['[data-message-author="user"]', 2],
      ['[data-message-author="assistant"]', 2],
      ['[data-user-message-bubble]', 2],
      ['[data-conversation-role="assistant"]', 2],
      ['[data-turn-key]', 4],
      ['[data-turn-id]', 4],
      ['[data-message-id]', 4],
      ['[data-testid^="conversation-turn-"]', 4],
      ['[data-testid="collapsible-user-message-content"]', 2],
      ['.markdown', 2],
      ['.prose', 2],
      ['a[href*="/c/"]', 8]
    ]);

    const fakeNode = { textContent: secretText } as unknown as Element;
    const root = {
      querySelectorAll(selector: string) {
        return Array.from({ length: counts.get(selector) ?? 0 }, () => fakeNode);
      },
      querySelector(selector: string) {
        if (selector === 'button[data-testid="stop-button"]') return fakeNode;
        if (selector === '[data-testid="mobile-app-shell-scroll-container"]') return fakeNode;
        return null;
      }
    } as unknown as ParentNode;

    const evidence = collectChatGptLiveQaDomEvidence(root, {
      adapterScrollContainer: fakeNode,
      documentScrollingElement: null,
      historyApiAvailable: true
    });

    expect(evidence.selectors.sectionUserTurns).toBe(2);
    expect(evidence.selectors.userMessageBubbleNodes).toBe(2);
    expect(evidence.selectors.assistantConversationRoleNodes).toBe(2);
    expect(evidence.selectors.turnKeyNodes).toBe(4);
    expect(evidence.selectors.conversationLinks).toBe(8);
    expect(evidence.stopGenerationControlPresent).toBe(true);
    expect(evidence.mobileAppShellScrollContainerPresent).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(secretText);
  });

  it('renders only allowlisted runtime/archive metadata and visible-activity counts', () => {
    const secret = 'TOP-SECRET-CHAT-TEXT';
    const activityText = 'PRIVATE-VISIBLE-ACTIVITY-TEXT';
    const report = buildLiveQaReport({
      generatedAt: '2026-09-16T12:00:00.000Z',
      extensionVersion: '0.1.0',
      route: {
        kind: 'conversation',
        pathSegmentCount: 2,
        queryPresent: false,
        hashPresent: false,
        providerConversationIdPresent: true,
        provisional: false,
        secret
      } as never,
      dom: {
        selectors: {
          sectionUserTurns: 2,
          sectionAssistantTurns: 2,
          articleTurns: 4,
          userRoleNodes: 2,
          assistantRoleNodes: 2,
          dataRoleUserNodes: 2,
          dataRoleAssistantNodes: 2,
          dataMessageAuthorUserNodes: 2,
          dataMessageAuthorAssistantNodes: 2,
          userMessageBubbleNodes: 2,
          assistantConversationRoleNodes: 2,
          turnKeyNodes: 4,
          turnIdNodes: 4,
          messageIdNodes: 4,
          conversationTurnTestIds: 4,
          collapsibleUserContent: 2,
          markdownWrappers: 2,
          proseWrappers: 2,
          conversationLinks: 12
        },
        stopGenerationControlPresent: false,
        adapterScrollContainerFound: true,
        adapterUsesDocumentScrollingElement: false,
        mobileAppShellScrollContainerPresent: true,
        historyApiAvailable: true,
        secret
      } as never,
      runtime: {
        adapterState: 'healthy',
        adapterCode: 'adapter-ready',
        recordingState: 'recording',
        storageHealth: 'healthy',
        renderedTurnCount: 4,
        lastSaveConfirmed: true,
        historicalImportAvailable: true,
        secret
      } as never,
      archive: {
        conversationFound: true,
        messageCount: 4,
        eventCount: 9,
        visibleActivityCount: 6,
        recordingState: 'recording',
        visibleActivityText: activityText,
        secret
      } as never
    });

    const json = renderLiveQaReportJson(report);
    expect(json).not.toContain(secret);
    expect(json).not.toContain(activityText);
    expect(json).not.toContain('sourceUrl');
    expect(json).not.toContain('title');
    expect(json).toContain('"messageCount": 4');
    expect(json).toContain('"visibleActivityCount": 6');
    expect(json).toContain('"containsChatText": false');
  });
});
