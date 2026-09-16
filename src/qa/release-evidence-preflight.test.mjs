import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/release-evidence-preflight.mjs');

function report() {
  return {
    schema: 'llm-chat-history/live-qa-report',
    schemaVersion: 1,
    generatedAt: '2026-09-16T16:46:21.823Z',
    extensionVersion: '0.1.0',
    providerId: 'chatgpt',
    route: {
      kind: 'conversation',
      pathSegmentCount: 4,
      queryPresent: false,
      hashPresent: false,
      providerConversationIdPresent: true,
      provisional: false
    },
    dom: {
      selectors: {
        sectionUserTurns: 6,
        sectionAssistantTurns: 4,
        articleTurns: 0,
        userRoleNodes: 6,
        assistantRoleNodes: 6,
        turnIdNodes: 10,
        messageIdNodes: 12,
        conversationTurnTestIds: 10,
        collapsibleUserContent: 0,
        markdownWrappers: 6,
        proseWrappers: 6,
        conversationLinks: 6
      },
      stopGenerationControlPresent: false,
      adapterScrollContainerFound: true,
      adapterUsesDocumentScrollingElement: false,
      mobileAppShellScrollContainerPresent: false,
      historyApiAvailable: true
    },
    runtime: {
      adapterState: 'healthy',
      adapterCode: 'adapter-ready',
      recordingState: 'recording',
      storageHealth: 'healthy',
      renderedTurnCount: 13,
      lastSaveConfirmed: true,
      historicalImportAvailable: true
    },
    archive: {
      conversationFound: true,
      messageCount: 13,
      eventCount: 42,
      visibleActivityCount: 14,
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

function session() {
  return {
    schema: 'llm-chat-history/release-qa-session',
    schemaVersion: 1,
    candidate: {
      commitSha: 'b611c3936a8902246692d4cad2d128c6af971cdc',
      version: '0.1.0',
      unpackedArtifact: 'llm-chat-history-unpacked-b611c3936a8902246692d4cad2d128c6af971cdc',
      unpackedArtifactSha256: '953650fb329547a9c30b607d9f6d12ac8e8b4f124333cb1fc2ae1fbe75bbf4fb',
      packagedArtifactSha256: 'f854458c8e1812ef0f5b294df5a89a7b2834ffd4a7829c537b0c7e93019d57b8',
      ciRunId: 35117220444
    },
    environment: {
      browser: 'Chrome',
      browserVersion: '152.0.0.0',
      os: 'Test OS'
    },
    testedAt: '2026-09-16T16:46:21.823Z',
    tester: 'QA Tester',
    scenarios: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      status: 'PASS',
      reports: ['report.json'],
      notes: ''
    }))
  };
}

async function evidenceDir() {
  const directory = await mkdtemp(resolve(tmpdir(), 'llmch-release-evidence-'));
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report()), 'utf8');
  await writeFile(resolve(directory, 'qa-session.json'), JSON.stringify(session()), 'utf8');
  return directory;
}

async function run(directory) {
  return execFileAsync(process.execPath, [script, '--evidence', directory], { cwd: root });
}

describe('release QA evidence preflight', () => {
  it('accepts ten PASS scenarios with the current strict QA schema', async () => {
    const directory = await evidenceDir();
    const result = await run(directory);
    expect(result.stdout).toContain('Release QA preflight PASS: 10 scenarios, 10 report(s)');

    const summary = await readFile(resolve(directory, 'release-qa-preflight.md'), 'utf8');
    expect(summary).toContain('Scenario 10: PASS');
    expect(summary).toContain('b611c3936a8902246692d4cad2d128c6af971cdc');
    expect(summary).toContain('Visible activity entries observed across QA snapshots');

    const approval = JSON.parse(await readFile(resolve(directory, 'release-approval.json'), 'utf8'));
    expect(approval.candidate.commitSha).toBe('b611c3936a8902246692d4cad2d128c6af971cdc');
    expect(approval.reportsValidated).toBe(10);
    expect(approval.allScenariosPass).toBe(true);
    const serialized = JSON.stringify(approval);
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('answer');
    expect(serialized).not.toContain('activity text');
    expect(serialized).not.toContain('rawUrl');
  });

  it('rejects reports missing visibleActivityCount', async () => {
    const directory = await evidenceDir();
    const invalid = report();
    delete invalid.archive.visibleActivityCount;
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(invalid), 'utf8');
    await expect(run(directory)).rejects.toMatchObject({ stderr: expect.stringContaining('missing required field: visibleActivityCount') });
  });

  it('rejects content-bearing or otherwise unexpected report fields', async () => {
    const directory = await evidenceDir();
    const invalid = report();
    invalid.archive.visibleActivityText = 'private visible activity text must never be in QA evidence';
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(invalid), 'utf8');
    await expect(run(directory)).rejects.toMatchObject({ stderr: expect.stringContaining('unexpected field: visibleActivityText') });
    await expect(readFile(resolve(directory, 'release-approval.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects visible activity without a canonical conversation/message', async () => {
    const directory = await evidenceDir();
    const invalid = report();
    invalid.archive.conversationFound = false;
    invalid.archive.messageCount = 0;
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(invalid), 'utf8');
    await expect(run(directory)).rejects.toThrow();
  });

  it('rejects incomplete human scenario approval', async () => {
    const directory = await evidenceDir();
    const invalid = session();
    invalid.scenarios[4].status = 'BLOCKED';
    await writeFile(resolve(directory, 'qa-session.json'), JSON.stringify(invalid), 'utf8');
    await expect(run(directory)).rejects.toMatchObject({ stderr: expect.stringContaining('Scenario 5 is not PASS') });
  });

  it('rejects evidence generated by a different extension version', async () => {
    const directory = await evidenceDir();
    const invalid = report();
    invalid.extensionVersion = '0.2.0';
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(invalid), 'utf8');
    await expect(run(directory)).rejects.toMatchObject({ stderr: expect.stringContaining('does not match 0.1.0') });
  });
});
