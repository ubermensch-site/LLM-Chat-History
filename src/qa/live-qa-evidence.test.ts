import { describe, expect, it } from 'vitest';
import { evaluateLiveQaEvidence, renderLiveQaEvidenceMarkdown } from './live-qa-evidence';
import type { LiveQaReport } from './live-qa-report';

function validReport(): LiveQaReport {
  return {
    schema: 'llm-chat-history/live-qa-report',
    schemaVersion: 1,
    generatedAt: '2026-09-16T12:30:00.000Z',
    extensionVersion: '0.1.0',
    providerId: 'chatgpt',
    route: {
      kind: 'conversation',
      pathSegmentCount: 2,
      queryPresent: false,
      hashPresent: false,
      providerConversationIdPresent: true,
      provisional: false
    },
    dom: {
      selectors: {
        sectionUserTurns: 2,
        sectionAssistantTurns: 2,
        articleTurns: 0,
        userRoleNodes: 2,
        assistantRoleNodes: 2,
        turnIdNodes: 4,
        messageIdNodes: 4,
        conversationTurnTestIds: 4,
        collapsibleUserContent: 2,
        markdownWrappers: 2,
        proseWrappers: 0,
        conversationLinks: 8
      },
      stopGenerationControlPresent: false,
      adapterScrollContainerFound: true,
      adapterUsesDocumentScrollingElement: false,
      mobileAppShellScrollContainerPresent: true,
      historyApiAvailable: true
    },
    runtime: {
      adapterState: 'healthy',
      adapterCode: 'ok',
      recordingState: 'recording',
      storageHealth: 'healthy',
      renderedTurnCount: 4,
      lastSaveConfirmed: true,
      historicalImportAvailable: true
    },
    archive: {
      conversationFound: true,
      messageCount: 4,
      eventCount: 7,
      recordingState: 'recording'
    },
    privacy: {
      containsChatText: false,
      containsRawUrl: false,
      containsConversationTitle: false,
      containsProviderConversationId: false
    }
  };
}

describe('evaluateLiveQaEvidence', () => {
  it('passes a healthy content-free conversation snapshot', () => {
    const result = evaluateLiveQaEvidence(validReport(), { expectedExtensionVersion: '0.1.0' });
    expect(result.schemaValid).toBe(true);
    expect(result.structuralPass).toBe(true);
    expect(result.checks.some((check) => check.status === 'fail')).toBe(false);
  });

  it('rejects extra fields rather than silently accepting content-bearing evidence', () => {
    const report = { ...validReport(), rawUrl: 'https://chatgpt.com/c/private-secret' };
    const result = evaluateLiveQaEvidence(report);
    expect(result.schemaValid).toBe(false);
    expect(result.structuralPass).toBe(false);
  });

  it('fails when privacy flags declare protected content present', () => {
    const report = validReport();
    report.privacy.containsChatText = true as false;
    const result = evaluateLiveQaEvidence(report);
    expect(result.structuralPass).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'privacy.flags', status: 'fail' }));
  });

  it('fails when rendered turns have no supported semantic selector evidence', () => {
    const report = validReport();
    report.dom.selectors.sectionUserTurns = 0;
    report.dom.selectors.sectionAssistantTurns = 0;
    report.dom.selectors.articleTurns = 0;
    report.dom.selectors.userRoleNodes = 0;
    report.dom.selectors.assistantRoleNodes = 0;
    const result = evaluateLiveQaEvidence(report);
    expect(result.structuralPass).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'dom.turn-selectors', status: 'fail' }));
  });

  it('warns rather than fails when semantic turns exist but stable ID selectors are absent', () => {
    const report = validReport();
    report.dom.selectors.turnIdNodes = 0;
    report.dom.selectors.messageIdNodes = 0;
    report.dom.selectors.conversationTurnTestIds = 0;
    const result = evaluateLiveQaEvidence(report);
    expect(result.structuralPass).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'dom.stable-ids', status: 'warn' }));
  });

  it('fails on recorder state disagreement between UI and canonical archive', () => {
    const report = validReport();
    report.archive.recordingState = 'paused';
    const result = evaluateLiveQaEvidence(report);
    expect(result.structuralPass).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'recorder.state-consistency', status: 'fail' }));
  });

  it('fails on the wrong extension version for a pinned candidate', () => {
    const result = evaluateLiveQaEvidence(validReport(), { expectedExtensionVersion: '0.1.1' });
    expect(result.structuralPass).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: 'release.version', status: 'fail' }));
  });

  it('renders a GitHub-safe Markdown summary without report content fields', () => {
    const result = evaluateLiveQaEvidence(validReport(), { expectedExtensionVersion: '0.1.0' });
    const markdown = renderLiveQaEvidenceMarkdown(result);
    expect(markdown).toContain('Structural result: **PASS**');
    expect(markdown).toContain('This validates one privacy-safe structural snapshot only');
    expect(markdown).not.toContain('chatgpt.com');
    expect(markdown).not.toContain('private-secret');
  });
});
