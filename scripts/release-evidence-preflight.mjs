import { readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

const SESSION_SCHEMA = 'llm-chat-history/release-qa-session';
const REPORT_SCHEMA = 'llm-chat-history/live-qa-report';
const APPROVAL_SCHEMA = 'llm-chat-history/release-approval';
const REQUIRED_SCENARIOS = [1,2,3,4,5,6,7,8,9,10];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function strictKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const keys = Object.keys(value);
  for (const key of keys) assert(allowed.includes(key), `${label} contains unexpected field: ${key}`);
  for (const key of allowed) assert(Object.hasOwn(value, key), `${label} is missing required field: ${key}`);
}

function nonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`);
  return value.trim();
}

function nonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function booleanField(value, label) {
  assert(typeof value === 'boolean', `${label} must be a boolean`);
}

function validateReport(report, expectedVersion) {
  strictKeys(report, ['schema','schemaVersion','generatedAt','extensionVersion','providerId','route','dom','runtime','archive','privacy'], 'QA report');
  assert(report.schema === REPORT_SCHEMA, `QA report schema must be ${REPORT_SCHEMA}`);
  assert(report.schemaVersion === 1, 'QA report schemaVersion must be 1');
  assert(report.extensionVersion === expectedVersion, `QA report version ${report.extensionVersion} does not match ${expectedVersion}`);
  assert(report.providerId === 'chatgpt', 'QA report providerId must be chatgpt');
  nonEmptyString(report.generatedAt, 'QA report generatedAt');

  strictKeys(report.route, ['kind','pathSegmentCount','queryPresent','hashPresent','providerConversationIdPresent','provisional'], 'QA report route');
  assert(['home','conversation','other-chatgpt'].includes(report.route.kind), 'QA report route.kind is invalid');
  nonNegativeInteger(report.route.pathSegmentCount, 'QA report route.pathSegmentCount');
  for (const key of ['queryPresent','hashPresent','providerConversationIdPresent','provisional']) booleanField(report.route[key], `QA report route.${key}`);

  strictKeys(report.dom, ['selectors','stopGenerationControlPresent','adapterScrollContainerFound','adapterUsesDocumentScrollingElement','mobileAppShellScrollContainerPresent','historyApiAvailable'], 'QA report dom');
  strictKeys(report.dom.selectors, ['sectionUserTurns','sectionAssistantTurns','articleTurns','userRoleNodes','assistantRoleNodes','turnIdNodes','messageIdNodes','conversationTurnTestIds','collapsibleUserContent','markdownWrappers','proseWrappers','conversationLinks'], 'QA report dom.selectors');
  for (const [key, value] of Object.entries(report.dom.selectors)) nonNegativeInteger(value, `QA report dom.selectors.${key}`);
  for (const key of ['stopGenerationControlPresent','adapterScrollContainerFound','adapterUsesDocumentScrollingElement','mobileAppShellScrollContainerPresent','historyApiAvailable']) booleanField(report.dom[key], `QA report dom.${key}`);

  strictKeys(report.runtime, ['adapterState','adapterCode','recordingState','storageHealth','renderedTurnCount','lastSaveConfirmed','historicalImportAvailable'], 'QA report runtime');
  assert(['healthy','degraded','error'].includes(report.runtime.adapterState), 'QA report runtime.adapterState is invalid');
  nonEmptyString(report.runtime.adapterCode, 'QA report runtime.adapterCode');
  assert(['recording','paused','stopped','error'].includes(report.runtime.recordingState), 'QA report runtime.recordingState is invalid');
  assert(['unknown','healthy','error'].includes(report.runtime.storageHealth), 'QA report runtime.storageHealth is invalid');
  nonNegativeInteger(report.runtime.renderedTurnCount, 'QA report runtime.renderedTurnCount');
  booleanField(report.runtime.lastSaveConfirmed, 'QA report runtime.lastSaveConfirmed');
  booleanField(report.runtime.historicalImportAvailable, 'QA report runtime.historicalImportAvailable');

  strictKeys(report.archive, ['conversationFound','messageCount','eventCount','visibleActivityCount','recordingState'], 'QA report archive');
  booleanField(report.archive.conversationFound, 'QA report archive.conversationFound');
  nonNegativeInteger(report.archive.messageCount, 'QA report archive.messageCount');
  nonNegativeInteger(report.archive.eventCount, 'QA report archive.eventCount');
  nonNegativeInteger(report.archive.visibleActivityCount, 'QA report archive.visibleActivityCount');
  assert(report.archive.recordingState === null || ['recording','paused','stopped','error'].includes(report.archive.recordingState), 'QA report archive.recordingState is invalid');

  strictKeys(report.privacy, ['containsChatText','containsRawUrl','containsConversationTitle','containsProviderConversationId'], 'QA report privacy');
  for (const key of Object.keys(report.privacy)) assert(report.privacy[key] === false, `QA report privacy.${key} must be false`);

  const semanticTurns = report.dom.selectors.sectionUserTurns + report.dom.selectors.sectionAssistantTurns + report.dom.selectors.articleTurns + report.dom.selectors.userRoleNodes + report.dom.selectors.assistantRoleNodes + report.dom.selectors.conversationTurnTestIds;
  if (report.runtime.renderedTurnCount > 0) assert(semanticTurns > 0, 'QA report has rendered turns but no semantic turn selectors');
  if (report.route.kind === 'conversation') assert(report.archive.conversationFound, 'Conversation route has no canonical archive record');
  if (report.archive.visibleActivityCount > 0) {
    assert(report.archive.conversationFound, 'Visible activity count requires a canonical conversation');
    assert(report.archive.messageCount > 0, 'Visible activity count requires at least one archived message');
  }
  assert(report.runtime.storageHealth !== 'error', 'QA report shows storageHealth=error');
  if (report.archive.recordingState !== null) assert(report.archive.recordingState === report.runtime.recordingState, 'Recorder/archive state mismatch');
}

function validateSession(session, expectedVersion) {
  strictKeys(session, ['schema','schemaVersion','candidate','environment','testedAt','tester','scenarios'], 'QA session');
  assert(session.schema === SESSION_SCHEMA, `QA session schema must be ${SESSION_SCHEMA}`);
  assert(session.schemaVersion === 1, 'QA session schemaVersion must be 1');

  strictKeys(session.candidate, ['commitSha','version','unpackedArtifact','unpackedArtifactSha256','packagedArtifactSha256','ciRunId'], 'QA session candidate');
  assert(/^[0-9a-f]{40}$/.test(nonEmptyString(session.candidate.commitSha, 'candidate.commitSha')), 'candidate.commitSha must be lowercase SHA-1 hex');
  assert(session.candidate.version === expectedVersion, `candidate.version ${session.candidate.version} does not match package version ${expectedVersion}`);
  nonEmptyString(session.candidate.unpackedArtifact, 'candidate.unpackedArtifact');
  assert(/^[0-9a-f]{64}$/.test(nonEmptyString(session.candidate.unpackedArtifactSha256, 'candidate.unpackedArtifactSha256')), 'candidate.unpackedArtifactSha256 must be SHA-256 hex');
  assert(/^[0-9a-f]{64}$/.test(nonEmptyString(session.candidate.packagedArtifactSha256, 'candidate.packagedArtifactSha256')), 'candidate.packagedArtifactSha256 must be SHA-256 hex');
  assert(Number.isInteger(session.candidate.ciRunId) && session.candidate.ciRunId > 0, 'candidate.ciRunId must be a positive integer');

  strictKeys(session.environment, ['browser','browserVersion','os'], 'QA session environment');
  nonEmptyString(session.environment.browser, 'environment.browser');
  nonEmptyString(session.environment.browserVersion, 'environment.browserVersion');
  nonEmptyString(session.environment.os, 'environment.os');
  nonEmptyString(session.testedAt, 'testedAt');
  nonEmptyString(session.tester, 'tester');

  assert(Array.isArray(session.scenarios), 'QA session scenarios must be an array');
  assert(session.scenarios.length === REQUIRED_SCENARIOS.length, `QA session must contain exactly ${REQUIRED_SCENARIOS.length} scenarios`);
  const seen = new Set();
  for (const scenario of session.scenarios) {
    strictKeys(scenario, ['id','status','reports','notes'], 'QA session scenario');
    assert(REQUIRED_SCENARIOS.includes(scenario.id), `Unknown scenario id: ${scenario.id}`);
    assert(!seen.has(scenario.id), `Duplicate scenario id: ${scenario.id}`);
    seen.add(scenario.id);
    assert(scenario.status === 'PASS', `Scenario ${scenario.id} is not PASS (${scenario.status})`);
    assert(Array.isArray(scenario.reports) && scenario.reports.length > 0, `Scenario ${scenario.id} must include at least one report`);
    assert(typeof scenario.notes === 'string', `Scenario ${scenario.id} notes must be a string`);
  }
  for (const id of REQUIRED_SCENARIOS) assert(seen.has(id), `Missing scenario ${id}`);
}

function safeReportPath(root, filename) {
  const value = nonEmptyString(filename, 'report filename');
  assert(!value.includes('..') && !value.includes('/') && !value.includes('\\'), `Unsafe report filename: ${value}`);
  const absolute = resolve(root, value);
  assert(!relative(root, absolute).split(sep).includes('..'), `Report escapes evidence directory: ${value}`);
  return absolute;
}

function renderMarkdown(session, reportsValidated, visibleActivityTotal) {
  const lines = [
    '# LLM Chat History v0.1 — Release QA Preflight',
    '',
    `- Candidate commit: \`${session.candidate.commitSha}\``,
    `- Version: \`${session.candidate.version}\``,
    `- CI run: \`${session.candidate.ciRunId}\``,
    `- Unpacked artifact: \`${session.candidate.unpackedArtifact}\``,
    `- Unpacked SHA-256: \`${session.candidate.unpackedArtifactSha256}\``,
    `- Packaged SHA-256: \`${session.candidate.packagedArtifactSha256}\``,
    `- Browser: ${session.environment.browser} ${session.environment.browserVersion}`,
    `- OS: ${session.environment.os}`,
    `- Tested at: ${session.testedAt}`,
    `- Tester: ${session.tester}`,
    `- QA reports structurally validated: ${reportsValidated}`,
    `- Visible activity entries observed across QA snapshots (count-only, snapshots may overlap): ${visibleActivityTotal}`,
    '',
    '## Scenarios',
    ''
  ];
  for (const scenario of [...session.scenarios].sort((a,b) => a.id - b.id)) {
    lines.push(`- [x] Scenario ${scenario.id}: PASS — ${scenario.reports.length} report(s)${scenario.notes ? ` — ${scenario.notes}` : ''}`);
  }
  lines.push('', '> This preflight validates evidence completeness, strict report schema/privacy, structural consistency, candidate metadata, and human-recorded scenario PASS status. It does not independently replay provider interactions or replace authenticated human runtime judgment.', '');
  return `${lines.join('\n')}\n`;
}

function buildApprovalManifest(session, reportsValidated) {
  return {
    schema: APPROVAL_SCHEMA,
    schemaVersion: 1,
    candidate: {
      commitSha: session.candidate.commitSha,
      version: session.candidate.version,
      unpackedArtifact: session.candidate.unpackedArtifact,
      unpackedArtifactSha256: session.candidate.unpackedArtifactSha256,
      packagedArtifactSha256: session.candidate.packagedArtifactSha256,
      ciRunId: session.candidate.ciRunId
    },
    environment: {
      browser: session.environment.browser,
      browserVersion: session.environment.browserVersion,
      os: session.environment.os
    },
    testedAt: session.testedAt,
    tester: session.tester,
    scenarioCount: REQUIRED_SCENARIOS.length,
    reportsValidated,
    allScenariosPass: true
  };
}

const args = process.argv.slice(2);
const evidenceIndex = args.indexOf('--evidence');
assert(evidenceIndex >= 0 && args[evidenceIndex + 1], 'Usage: node scripts/release-evidence-preflight.mjs --evidence <directory> [--output <markdown>] [--approval-output <json>]');
const evidenceDir = resolve(args[evidenceIndex + 1]);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? resolve(args[outputIndex + 1]) : resolve(evidenceDir, 'release-qa-preflight.md');
const approvalOutputIndex = args.indexOf('--approval-output');
const approvalOutputPath = approvalOutputIndex >= 0 && args[approvalOutputIndex + 1] ? resolve(args[approvalOutputIndex + 1]) : resolve(evidenceDir, 'release-approval.json');

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const expectedVersion = nonEmptyString(packageJson.version, 'package.json version');
const session = JSON.parse(await readFile(resolve(evidenceDir, 'qa-session.json'), 'utf8'));
validateSession(session, expectedVersion);

let reportsValidated = 0;
let visibleActivityTotal = 0;
for (const scenario of session.scenarios) {
  for (const reportFile of scenario.reports) {
    const report = JSON.parse(await readFile(safeReportPath(evidenceDir, reportFile), 'utf8'));
    validateReport(report, expectedVersion);
    reportsValidated += 1;
    visibleActivityTotal += report.archive.visibleActivityCount;
  }
}

const markdown = renderMarkdown(session, reportsValidated, visibleActivityTotal);
await writeFile(outputPath, markdown, 'utf8');
const approval = buildApprovalManifest(session, reportsValidated);
await writeFile(approvalOutputPath, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
console.log(`Release QA preflight PASS: ${REQUIRED_SCENARIOS.length} scenarios, ${reportsValidated} report(s)`);
console.log(`Summary: ${relative(process.cwd(), outputPath) || basename(outputPath)}`);
console.log(`Approval manifest: ${relative(process.cwd(), approvalOutputPath) || basename(approvalOutputPath)}`);
