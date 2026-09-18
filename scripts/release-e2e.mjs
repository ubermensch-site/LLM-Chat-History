import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, 'dist');
const HOST_ID = 'llm-chat-history-recorder-host';
const DB_NAME = 'llm-chat-history';

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function fixtureHtml(title = 'ChatGPT') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    html, body { margin: 0; min-height: 100%; font-family: sans-serif; }
    #scroll { height: 720px; overflow-y: auto; }
    #fixture-chat { min-height: 100%; padding: 24px; }
    section[data-turn] { min-height: 48px; margin: 10px 0; }
  </style>
</head>
<body>
  <div id="scroll"><main id="fixture-chat"></main></div>
</body>
</html>`;
}

async function renderConversation(page, {
  title,
  conversationId,
  turns,
  generating = false,
  navigation = 'none'
}) {
  await page.evaluate((input) => {
    const route = input.conversationId ? `/c/${input.conversationId}` : '/';
    if (input.navigation === 'push') history.pushState({}, '', route);
    if (input.navigation === 'replace') history.replaceState({}, '', route);
    document.title = input.title ? `${input.title} - ChatGPT` : 'ChatGPT';

    const root = document.getElementById('fixture-chat');
    if (!root) throw new Error('Missing fixture-chat');
    root.replaceChildren();

    input.turns.forEach((turn, index) => {
      const shell = document.createElement('section');
      shell.dataset.turn = turn.role;
      shell.dataset.turnId = turn.turnId;
      shell.dataset.testid = `conversation-turn-${index}`;

      const message = document.createElement('div');
      message.dataset.messageAuthorRole = turn.role;
      message.dataset.messageId = turn.messageId;

      if (turn.role === 'user') {
        const content = document.createElement('div');
        content.dataset.testid = 'collapsible-user-message-content';
        content.textContent = turn.text;
        message.append(content);
      } else {
        for (const [activityIndex, activity] of (turn.activities ?? []).entries()) {
          const activityNode = document.createElement('button');
          activityNode.type = 'button';
          activityNode.dataset.testid = activity.testId ?? `work-step-${activityIndex}`;
          activityNode.textContent = activity.text;
          message.append(activityNode);
        }
        if (turn.modelLabel) {
          const model = document.createElement('button');
          model.type = 'button';
          model.dataset.testid = 'model-label';
          model.setAttribute('aria-label', 'Model');
          model.textContent = turn.modelLabel;
          message.append(model);
        }
        const answer = document.createElement('div');
        answer.className = 'markdown';
        answer.textContent = turn.text;
        message.append(answer);
      }

      shell.append(message);
      root.append(shell);
    });

    document.querySelector('[data-testid="stop-button"]')?.remove();
    if (input.generating) {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.dataset.testid = 'stop-button';
      stop.textContent = 'Stop';
      document.body.append(stop);
    }
  }, { title, conversationId, turns, generating, navigation });
}

function userTurn(id, text) {
  return { role: 'user', turnId: id, messageId: id, text };
}

function assistantTurn(turnId, messageId, text, extra = {}) {
  return { role: 'assistant', turnId, messageId, text, ...extra };
}

async function getArchive(driverPage) {
  return driverPage.evaluate(async (dbName) => {
    const db = await new Promise((resolveDb, rejectDb) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => rejectDb(request.error ?? new Error('IndexedDB open failed'));
    });

    const readAll = (storeName) => new Promise((resolveStore, rejectStore) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolveStore(request.result);
      request.onerror = () => rejectStore(request.error ?? new Error(`Failed reading ${storeName}`));
    });

    try {
      const [conversations, messages, events] = await Promise.all([
        readAll('conversations'),
        readAll('messages'),
        readAll('events')
      ]);
      return { conversations, messages, events };
    } finally {
      db.close();
    }
  }, DB_NAME);
}

async function waitForArchive(driverPage, predicate, label, timeoutMs = 12000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await getArchive(driverPage);
    if (predicate(last)) return last;
    await sleep(150);
  }
  throw new Error(`${label} did not converge. Last archive: ${JSON.stringify(last)}`);
}

function messagesFor(archive, conversation) {
  return archive.messages
    .filter((message) => message.conversationId === conversation.id)
    .sort((a, b) => a.orderHint - b.orderHint || a.firstObservedAt.localeCompare(b.firstObservedAt));
}

function eventsFor(archive, conversation) {
  return archive.events
    .filter((event) => event.conversationId === conversation.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function sendRecorderCommand(driverPage, conversation, command) {
  return driverPage.evaluate(async ({ conversation, command }) => {
    return chrome.runtime.sendMessage({
      type: 'LLMCH_RECORDER_COMMAND',
      requestId: crypto.randomUUID(),
      providerId: 'chatgpt',
      sourceSessionId: 'automated-release-e2e',
      pageUrl: conversation.sourceUrl,
      identity: {
        providerId: 'chatgpt',
        providerConversationId: conversation.providerConversationId,
        sourceUrl: conversation.sourceUrl,
        provisional: false
      },
      command,
      observedAt: new Date().toISOString()
    });
  }, { conversation, command });
}

function attrs(node) {
  const result = {};
  const raw = node.attributes ?? [];
  for (let index = 0; index < raw.length; index += 2) {
    result[raw[index]] = raw[index + 1];
  }
  return result;
}

function nodeText(node) {
  let value = node.nodeName === '#text' ? (node.nodeValue ?? '') : '';
  for (const child of node.children ?? []) value += nodeText(child);
  for (const shadow of node.shadowRoots ?? []) value += nodeText(shadow);
  return value;
}

function walkNodes(node, visit) {
  if (visit(node)) return node;
  for (const shadow of node.shadowRoots ?? []) {
    const found = walkNodes(shadow, visit);
    if (found) return found;
  }
  for (const child of node.children ?? []) {
    const found = walkNodes(child, visit);
    if (found) return found;
  }
  return null;
}

async function recorderShadowSnapshot(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    const { root: domRoot } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = walkNodes(domRoot, (node) => attrs(node).id === HOST_ID);
    if (!host) throw new Error('Recorder host not found in pierced DOM');
    return { session, domRoot, host };
  } catch (error) {
    await session.detach();
    throw error;
  }
}

async function shadowNode(page, predicate) {
  const snapshot = await recorderShadowSnapshot(page);
  try {
    const found = walkNodes(snapshot.host, predicate);
    return found ? { node: found, session: snapshot.session } : { node: null, session: snapshot.session };
  } catch (error) {
    await snapshot.session.detach();
    throw error;
  }
}

async function clickShadow(page, predicate, label) {
  const { node, session } = await shadowNode(page, predicate);
  try {
    if (!node) throw new Error(`Recorder control not found: ${label}`);
    const model = await session.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
    const quad = model.model.content;
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    await page.mouse.click(x, y);
  } finally {
    await session.detach();
  }
}

async function clickRecorderPill(page) {
  await clickShadow(
    page,
    (node) => node.nodeName === 'BUTTON' && (attrs(node).class ?? '').split(/\s+/).includes('pill'),
    'recorder pill'
  );
}

async function clickRecorderText(page, text, nodeName = 'BUTTON') {
  await clickShadow(
    page,
    (node) => node.nodeName === nodeName && nodeText(node).trim() === text,
    text
  );
}

async function recorderControlDisabled(page, text) {
  const { node, session } = await shadowNode(
    page,
    (candidate) => candidate.nodeName === 'BUTTON' && nodeText(candidate).trim() === text
  );
  try {
    if (!node) throw new Error(`Recorder control not found: ${text}`);
    return Object.hasOwn(attrs(node), 'disabled');
  } finally {
    await session.detach();
  }
}

async function recorderText(page) {
  const snapshot = await recorderShadowSnapshot(page);
  try {
    return nodeText(snapshot.host).replace(/\s+/g, ' ').trim();
  } finally {
    await snapshot.session.detach();
  }
}

async function waitForRecorderText(page, pattern, label, timeoutMs = 15000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    last = await recorderText(page);
    if (pattern.test(last)) return last;
    await sleep(120);
  }
  throw new Error(`${label} did not appear in recorder text. Last text: ${last}`);
}

async function createHarness(name) {
  const userDataDir = await mkdtemp(join(tmpdir(), `llmch-${name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  await context.route('https://chatgpt.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureHtml()
    });
  });

  const page = context.pages()[0] ?? await context.newPage();

  async function open(url = 'https://chatgpt.com/') {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator(`#${HOST_ID}`).waitFor({ state: 'attached', timeout: 15000 });

    const worker = context.serviceWorkers()[0] ??
      await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;

    const driverPage = await context.newPage();
    await driverPage.goto(`chrome-extension://${extensionId}/library.html`, {
      waitUntil: 'domcontentloaded'
    });
    await driverPage.waitForFunction(() => {
      const count = document.getElementById('count');
      return Boolean(count && !count.textContent?.includes('Loading'));
    }, null, { timeout: 15000 });

    return { page, worker, extensionId, driverPage };
  }

  async function close() {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }

  return { context, page, open, close };
}

async function runScenario(name, fn) {
  process.stdout.write(`• ${name} ... `);
  const harness = await createHarness(name.replace(/\W+/g, '-').toLowerCase());
  try {
    await fn(harness);
    console.log('PASS');
  } catch (error) {
    console.log('FAIL');
    throw error;
  } finally {
    await harness.close();
  }
}

await readFile(resolve(extensionPath, 'manifest.json'), 'utf8');

await runScenario('Scenario 1 — existing conversation baseline', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-baseline');
  await renderConversation(page, {
    title: 'Automated baseline',
    conversationId: 'e2e-baseline',
    turns: [
      userTurn('u1', 'baseline user'),
      assistantTurn('a1', 'm1', 'baseline assistant')
    ]
  });

  const archive = await waitForArchive(
    driverPage,
    (value) => value.conversations.length === 1 && value.messages.length === 2,
    'baseline archive'
  );
  const conversation = archive.conversations[0];
  assert.equal(conversation.providerConversationId, 'e2e-baseline');
  assert.equal(conversation.provisional, false);
  assert.equal(conversation.messageCount, 2);
  assert.deepEqual(messagesFor(archive, conversation).map((message) => message.role), ['user', 'assistant']);

  await driverPage.reload({ waitUntil: 'domcontentloaded' });
  await driverPage.waitForFunction(() => !document.getElementById('count')?.textContent?.includes('Loading'));
  const persisted = await getArchive(driverPage);
  assert.equal(persisted.conversations.length, 1);
  assert.equal(persisted.messages.length, 2);
});

await runScenario('Scenario 2 — provisional to stable identity promotion', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/');
  await waitForArchive(
    driverPage,
    (value) => value.conversations.length === 1 && value.conversations[0].provisional === true,
    'provisional conversation'
  );

  await renderConversation(page, {
    title: 'Promoted chat',
    conversationId: 'e2e-promoted',
    navigation: 'push',
    turns: [
      userTurn('u2', 'promotion user'),
      assistantTurn('a2', 'm2', 'promotion assistant')
    ]
  });

  const archive = await waitForArchive(
    driverPage,
    (value) =>
      value.conversations.length === 1 &&
      value.conversations[0].providerConversationId === 'e2e-promoted' &&
      value.messages.length === 2,
    'stable promoted conversation'
  );
  assert.equal(archive.conversations[0].provisional, false);
  assert.equal(archive.conversations[0].messageCount, 2);
});

await runScenario('Scenario 3 — streaming, activity and finalization', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-stream');
  const user = userTurn('u3', 'streaming prompt');
  const partialAssistant = assistantTurn(
    'assistant-shell',
    'assistant-message-stable',
    'partial answer',
    {
      activities: [{ text: 'Thinking', testId: 'reasoning-summary' }],
      modelLabel: 'GPT-5.6'
    }
  );

  await renderConversation(page, {
    title: 'Streaming test',
    conversationId: 'e2e-stream',
    turns: [user, partialAssistant],
    generating: true
  });

  let archive = await waitForArchive(
    driverPage,
    (value) => value.messages.some((message) => message.role === 'assistant' && message.partial === true),
    'streaming partial'
  );
  assert.equal(archive.messages.filter((message) => message.role === 'assistant').length, 1);

  await clickRecorderPill(page);
  await clickRecorderText(page, 'More options', 'SUMMARY');
  page.once('dialog', (dialog) => void dialog.accept());
  await clickRecorderText(page, 'Bring in older messages');
  await sleep(250);
  assert.match(await recorderText(page), /Wait for the assistant response to finish before importing history/i);

  const finalAssistant = assistantTurn(
    'assistant-shell',
    'assistant-message-stable',
    'complete streamed answer',
    {
      activities: [{ text: 'Thinking', testId: 'reasoning-summary' }],
      modelLabel: 'GPT-5.6'
    }
  );
  await renderConversation(page, {
    title: 'Streaming test',
    conversationId: 'e2e-stream',
    turns: [user, finalAssistant],
    generating: false
  });

  archive = await waitForArchive(
    driverPage,
    (value) => {
      const assistants = value.messages.filter((message) => message.role === 'assistant');
      return assistants.length === 1 && assistants[0].partial === false && assistants[0].plainText === 'complete streamed answer';
    },
    'streaming final'
  );
  const conversation = archive.conversations[0];
  const assistant = messagesFor(archive, conversation).find((message) => message.role === 'assistant');
  assert.equal(assistant.modelLabel, 'GPT-5.6');
  assert.equal(assistant.visibleActivities?.some((entry) => entry.text === 'Thinking'), true);
  assert.equal(eventsFor(archive, conversation).some((event) => event.type === 'message-finalized'), true);
});

await runScenario('Scenario 4 — SPA navigation and stable provider message identity', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-a');
  const chatA = [
    userTurn('a-user', 'chat a user'),
    assistantTurn('a-assistant', 'a-provider-message', 'chat a assistant')
  ];
  await renderConversation(page, {
    title: 'Chat A',
    conversationId: 'e2e-a',
    turns: chatA
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 2, 'chat A capture');

  const chatB = [
    userTurn('b-user', 'chat b user'),
    assistantTurn('b-shell-original', 'b-provider-message', 'scenario 4 chat b')
  ];
  await renderConversation(page, {
    title: 'Chat B',
    conversationId: 'e2e-b',
    navigation: 'push',
    turns: chatB
  });
  await waitForArchive(
    driverPage,
    (value) => value.conversations.length === 2 && value.messages.length === 4,
    'chat B capture'
  );

  await renderConversation(page, {
    title: 'Chat A',
    conversationId: 'e2e-a',
    navigation: 'push',
    turns: chatA
  });
  await sleep(800);

  await renderConversation(page, {
    title: 'Chat B',
    conversationId: 'e2e-b',
    navigation: 'push',
    turns: [
      chatB[0],
      assistantTurn('b-shell-rerendered', 'b-provider-message', 'scenario 4 chat b')
    ]
  });

  const archive = await waitForArchive(
    driverPage,
    (value) => value.conversations.length === 2 && value.messages.length === 4,
    'SPA revisit dedupe'
  );
  const a = archive.conversations.find((entry) => entry.providerConversationId === 'e2e-a');
  const b = archive.conversations.find((entry) => entry.providerConversationId === 'e2e-b');
  assert.ok(a && b);
  assert.equal(messagesFor(archive, a).length, 2);
  assert.equal(messagesFor(archive, b).length, 2);
  assert.equal(messagesFor(archive, a).some((message) => message.plainText.includes('scenario 4 chat b')), false);
  assert.equal(
    new Set(messagesFor(archive, b).map((message) => message.providerMessageId).filter(Boolean)).size,
    2
  );
});

await runScenario('Scenario 5 — pause, private interval and resume', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-pause');
  const before = [
    userTurn('p-u1', 'scenario 5 before pause'),
    assistantTurn('p-a1', 'p-m1', 'scenario 5 before pause')
  ];
  await renderConversation(page, {
    title: 'Pause privacy',
    conversationId: 'e2e-pause',
    turns: before
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 2, 'pre-pause capture');

  await clickRecorderPill(page);
  await clickRecorderText(page, 'Pause saving');
  await sleep(250);
  assert.match(await recorderText(page), /Paused/);

  await clickRecorderText(page, 'More options', 'SUMMARY');
  assert.equal(await recorderControlDisabled(page, 'Bring in older messages'), true);

  const privateWindow = [
    ...before,
    userTurn('p-u2', 'scenario 5 private interval'),
    assistantTurn('p-a2', 'p-m2', 'scenario 5 private interval', {
      activities: [{ text: 'Private paused activity', testId: 'reasoning-summary' }]
    })
  ];
  await renderConversation(page, {
    title: 'Pause privacy',
    conversationId: 'e2e-pause',
    turns: privateWindow
  });
  await sleep(500);

  await clickRecorderText(page, 'Resume saving');
  await sleep(250);

  const after = [
    ...privateWindow,
    userTurn('p-u3', 'scenario 5 after resume'),
    assistantTurn('p-a3', 'p-m3', 'scenario 5 after resume')
  ];
  await renderConversation(page, {
    title: 'Pause privacy',
    conversationId: 'e2e-pause',
    turns: after
  });

  let archive = await waitForArchive(
    driverPage,
    (value) =>
      value.messages.some((message) => message.plainText === 'scenario 5 after resume') &&
      value.messages.length === 4,
    'post-resume capture'
  );

  await renderConversation(page, {
    title: 'Other chat',
    conversationId: 'e2e-other',
    navigation: 'push',
    turns: [userTurn('other-u', 'other'), assistantTurn('other-a', 'other-m', 'other')]
  });
  await sleep(700);
  await renderConversation(page, {
    title: 'Pause privacy',
    conversationId: 'e2e-pause',
    navigation: 'push',
    turns: after
  });
  await sleep(700);

  archive = await getArchive(driverPage);
  const conversation = archive.conversations.find((entry) => entry.providerConversationId === 'e2e-pause');
  assert.ok(conversation);
  const stored = messagesFor(archive, conversation);
  assert.deepEqual(
    stored.map((message) => message.plainText),
    ['scenario 5 before pause', 'scenario 5 before pause', 'scenario 5 after resume', 'scenario 5 after resume']
  );
  assert.equal(JSON.stringify(stored).includes('scenario 5 private interval'), false);
  assert.equal(JSON.stringify(stored).includes('Private paused activity'), false);
  const boundaryEvents = eventsFor(archive, conversation).map((event) => event.type);
  assert.equal(boundaryEvents.includes('recording-paused'), true);
  assert.equal(boundaryEvents.includes('recording-resumed'), true);
});

await runScenario('Scenario 6 — stop, persistence and explicit start', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-stop');
  const baseline = [
    userTurn('s-u1', 'before stop'),
    assistantTurn('s-a1', 's-m1', 'before stop')
  ];
  await renderConversation(page, {
    title: 'Stop persistence',
    conversationId: 'e2e-stop',
    turns: baseline
  });
  let archive = await waitForArchive(driverPage, (value) => value.messages.length === 2, 'pre-stop capture');
  const conversation = archive.conversations[0];

  await clickRecorderPill(page);
  await clickRecorderText(page, 'More options', 'SUMMARY');
  await clickRecorderText(page, 'Stop saving');
  await clickRecorderText(page, 'Yes, stop saving');
  await sleep(300);
  assert.match(await recorderText(page), /Stopped/);

  const stoppedWindow = [
    ...baseline,
    userTurn('s-u2', 'private while stopped'),
    assistantTurn('s-a2', 's-m2', 'private while stopped')
  ];
  await renderConversation(page, {
    title: 'Stop persistence',
    conversationId: 'e2e-stop',
    turns: stoppedWindow
  });
  await sleep(450);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`#${HOST_ID}`).waitFor({ state: 'attached', timeout: 15000 });
  await renderConversation(page, {
    title: 'Stop persistence',
    conversationId: 'e2e-stop',
    turns: stoppedWindow
  });
  await sleep(700);
  assert.match(await recorderText(page), /Stopped/);

  await clickRecorderPill(page);
  await clickRecorderText(page, 'Start saving');
  await sleep(250);

  const restarted = [
    ...stoppedWindow,
    userTurn('s-u3', 'after explicit start'),
    assistantTurn('s-a3', 's-m3', 'after explicit start')
  ];
  await renderConversation(page, {
    title: 'Stop persistence',
    conversationId: 'e2e-stop',
    turns: restarted
  });

  archive = await waitForArchive(
    driverPage,
    (value) => value.messages.some((message) => message.plainText === 'after explicit start'),
    'capture after explicit start'
  );
  const stored = messagesFor(archive, conversation);
  assert.equal(stored.some((message) => message.plainText === 'private while stopped'), false);
  assert.equal(stored.filter((message) => message.plainText === 'after explicit start').length, 2);
});

await runScenario('Scenario 7 — collapse, hide, restore and position persistence', async (harness) => {
  const { page, driverPage, worker } = await harness.open('https://chatgpt.com/c/e2e-ui');
  let turns = [
    userTurn('v-u1', 'visible baseline'),
    assistantTurn('v-a1', 'v-m1', 'visible baseline')
  ];
  await renderConversation(page, {
    title: 'Visibility semantics',
    conversationId: 'e2e-ui',
    turns
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 2, 'visibility baseline');

  await clickRecorderPill(page);
  await clickRecorderText(page, 'Collapse');

  turns = [
    ...turns,
    userTurn('v-u2', 'captured while collapsed'),
    assistantTurn('v-a2', 'v-m2', 'captured while collapsed')
  ];
  await renderConversation(page, {
    title: 'Visibility semantics',
    conversationId: 'e2e-ui',
    turns
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 4, 'collapsed capture');

  await clickRecorderPill(page);
  await clickRecorderText(page, 'Hide');
  await page.waitForFunction((id) => document.getElementById(id)?.style.display === 'none', HOST_ID);

  turns = [
    ...turns,
    userTurn('v-u3', 'captured while hidden'),
    assistantTurn('v-a3', 'v-m3', 'captured while hidden')
  ];
  await renderConversation(page, {
    title: 'Visibility semantics',
    conversationId: 'e2e-ui',
    turns
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 6, 'hidden capture');

  const restoreAck = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    const target = tabs.find((tab) => typeof tab.id === 'number');
    if (!target?.id) throw new Error('Fixture tab not found');
    return chrome.tabs.sendMessage(target.id, { type: 'LLMCH_SHOW_RECORDER' });
  });
  assert.equal(restoreAck?.ok, true);
  await page.waitForFunction((id) => document.getElementById(id)?.style.display !== 'none', HOST_ID);

  await driverPage.evaluate(async () => {
    await chrome.storage.local.set({ 'llmch.recorderPosition': { x: 140, y: 160 } });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`#${HOST_ID}`).waitFor({ state: 'attached', timeout: 15000 });
  await renderConversation(page, {
    title: 'Visibility semantics',
    conversationId: 'e2e-ui',
    turns
  });
  await sleep(500);
  const position = await page.locator(`#${HOST_ID}`).evaluate((host) => ({
    left: Number.parseFloat(host.style.left),
    top: Number.parseFloat(host.style.top)
  }));
  assert.ok(Math.abs(position.left - 140) <= 2, `expected recorder x≈140, got ${position.left}`);
  assert.ok(Math.abs(position.top - 160) <= 2, `expected recorder y≈160, got ${position.top}`);
});

await runScenario('Scenario 8 — refresh and MV3 worker recovery', async (harness) => {
  const opened = await harness.open('https://chatgpt.com/c/e2e-recovery');
  const { page, driverPage, extensionId } = opened;
  const baseline = [
    userTurn('r-u1', 'recovery baseline'),
    assistantTurn('r-a1', 'r-m1', 'recovery baseline')
  ];
  await renderConversation(page, {
    title: 'Recovery',
    conversationId: 'e2e-recovery',
    turns: baseline
  });
  await waitForArchive(driverPage, (value) => value.messages.length === 2, 'recovery baseline');

  // Terminate only the MV3 background service-worker target. This models normal
  // worker suspension/restart without reloading or disabling the whole extension.
  const cdp = await harness.context.newCDPSession(page);
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const backgroundTarget = targetInfos.find(
      (target) =>
        target.type === 'service_worker' &&
        target.url === `chrome-extension://${extensionId}/background.js`
    );
    assert.ok(backgroundTarget, 'background service-worker target was not found');
    const closed = await cdp.send('Target.closeTarget', { targetId: backgroundTarget.targetId });
    assert.equal(closed.success, true);
  } finally {
    await cdp.detach();
  }

  await sleep(350);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`#${HOST_ID}`).waitFor({ state: 'attached', timeout: 15000 });

  const after = [
    ...baseline,
    userTurn('r-u2', 'after worker restart'),
    assistantTurn('r-a2', 'r-m2', 'after worker restart')
  ];
  await renderConversation(page, {
    title: 'Recovery',
    conversationId: 'e2e-recovery',
    turns: after
  });

  const archive = await waitForArchive(
    driverPage,
    (value) =>
      value.conversations.length === 1 &&
      value.messages.length === 4 &&
      value.messages.some((message) => message.plainText === 'after worker restart'),
    'post-worker-restart capture'
  );
  assert.equal(archive.conversations[0].providerConversationId, 'e2e-recovery');
});

await runScenario('Scenario 9 — virtualized historical import and idempotency', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-history');
  const allTurns = [
    userTurn('h-u1', 'history 1'),
    assistantTurn('h-a1', 'h-m1', 'history 2'),
    userTurn('h-u2', 'history 3'),
    assistantTurn('h-a2', 'h-m2', 'history 4'),
    userTurn('h-u3', 'history 5'),
    assistantTurn('h-a3', 'h-m3', 'history 6')
  ];

  await page.evaluate(() => {
    const scroll = document.getElementById('scroll');
    if (!scroll) throw new Error('Missing scroll fixture');
    scroll.style.height = '240px';
    const root = document.getElementById('fixture-chat');
    root.style.minHeight = '1200px';
    root.style.position = 'relative';
  });

  await page.exposeFunction('__llmchRenderHistoryWindow', async (windowIndex) => {
    const windows = [
      allTurns.slice(0, 3),
      allTurns.slice(2, 5),
      allTurns.slice(4, 6)
    ];
    await renderConversation(page, {
      title: 'Historical import',
      conversationId: 'e2e-history',
      turns: windows[windowIndex],
      generating: false
    });
  });

  await page.evaluate(() => {
    const scroll = document.getElementById('scroll');
    let lastWindow = -1;
    const choose = () => {
      const ratio = scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      const next = ratio < 0.34 ? 0 : ratio < 0.67 ? 1 : 2;
      if (next === lastWindow) return;
      lastWindow = next;
      void window.__llmchRenderHistoryWindow(next);
    };
    scroll.addEventListener('scroll', choose);
    scroll.scrollTop = scroll.scrollHeight;
    choose();
  });
  await sleep(650);

  await clickRecorderPill(page);
  await clickRecorderText(page, 'More options', 'SUMMARY');
  page.once('dialog', (dialog) => void dialog.accept());
  await clickRecorderText(page, 'Bring in older messages');
  await waitForRecorderText(
    page,
    /Bringing in older messages/,
    'historical import start'
  );
  await waitForRecorderText(
    page,
    /Done\. Found 6 unique messages/,
    'historical import completion',
    20000
  );

  const archive = await waitForArchive(
    driverPage,
    (value) => value.messages.length === 6,
    'historical import all turns',
    20000
  );
  const conversation = archive.conversations[0];
  assert.deepEqual(
    messagesFor(archive, conversation).map((message) => message.plainText),
    allTurns.map((turn) => turn.text)
  );

  let bottomOffset = await page.evaluate(() => {
    const scroll = document.getElementById('scroll');
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
  });
  assert.ok(bottomOffset <= 6, `historical import did not restore bottom position: ${bottomOffset}`);

  const beforeSecondImport = archive.messages.length;
  page.once('dialog', (dialog) => void dialog.accept());
  await clickRecorderText(page, 'Bring in older messages');
  await waitForRecorderText(
    page,
    /Bringing in older messages/,
    'second historical import start'
  );
  await waitForRecorderText(
    page,
    /Done\. Found 6 unique messages/,
    'second historical import completion',
    20000
  );
  const afterSecondImport = await getArchive(driverPage);
  assert.equal(afterSecondImport.messages.length, beforeSecondImport);

  bottomOffset = await page.evaluate(() => {
    const scroll = document.getElementById('scroll');
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
  });
  assert.ok(bottomOffset <= 6, `second historical import did not restore bottom position: ${bottomOffset}`);
});

await runScenario('Scenario 10 — Library search, export, appearance and keyboard', async (harness) => {
  const { page, driverPage } = await harness.open('https://chatgpt.com/c/e2e-library');
  await renderConversation(page, {
    title: 'Library automation',
    conversationId: 'e2e-library',
    turns: [
      userTurn('l-u1', '<img src=x onerror=alert(1)> literal user content'),
      assistantTurn('l-a1', 'l-m1', 'unique searchable assistant phrase', {
        activities: [{ text: 'Indexed fixture work', testId: 'work-step' }],
        modelLabel: 'GPT-5.6'
      })
    ]
  });

  await waitForArchive(
    driverPage,
    (value) =>
      value.messages.length === 2 &&
      value.messages.some((message) => message.visibleActivities?.length),
    'Library fixture capture'
  );

  await driverPage.reload({ waitUntil: 'domcontentloaded' });
  await driverPage.waitForFunction(() => document.querySelectorAll('#transcript .message').length === 2);

  assert.equal(await driverPage.locator('#transcript img').count(), 0);
  assert.match(await driverPage.locator('#transcript').innerText(), /<img src=x onerror=alert\(1\)>/);
  assert.match(await driverPage.locator('#transcript').innerText(), /What ChatGPT showed while working \(1\)/);
  assert.match(await driverPage.locator('#transcript').innerText(), /Model shown by ChatGPT: GPT-5\.6/);

  await driverPage.keyboard.press('Control+K');
  assert.equal(await driverPage.locator('#search').evaluate((element) => document.activeElement === element), true);
  await driverPage.keyboard.type('unique searchable assistant phrase');
  await driverPage.waitForFunction(() => {
    const panel = document.getElementById('search-results');
    return Boolean(panel && !panel.hidden && panel.querySelector('.search-result'));
  });
  assert.match(await driverPage.locator('#search-results').innerText(), /Message match/i);

  await driverPage.keyboard.press('Escape');
  assert.equal(await driverPage.locator('#search').inputValue(), '');

  await driverPage.locator('#search').fill('Indexed fixture work');
  await driverPage.locator('#search').dispatchEvent('input');
  await driverPage.waitForFunction(() => {
    const panel = document.getElementById('search-results');
    return Boolean(panel && !panel.hidden && panel.textContent?.includes('Indexed fixture work'));
  });

  await driverPage.locator('#search').fill('definitely-no-match-llmch');
  await driverPage.locator('#search').dispatchEvent('input');
  await driverPage.waitForFunction(() => document.querySelector('#search-results .search-result-empty'));
  assert.match(await driverPage.locator('#search-results').innerText(), /No matching/);

  await driverPage.locator('#search').fill('');
  await driverPage.locator('#search').dispatchEvent('input');

  await driverPage.locator('#theme-dark').click();
  await driverPage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await driverPage.reload({ waitUntil: 'domcontentloaded' });
  await driverPage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

  const markdownDownloadPromise = driverPage.waitForEvent('download');
  await driverPage.locator('#download-md').click();
  const markdownDownload = await markdownDownloadPromise;
  assert.match(markdownDownload.suggestedFilename(), /\.md$/);
  const markdownPath = await markdownDownload.path();
  const markdown = await readFile(markdownPath, 'utf8');
  assert.match(markdown, /unique searchable assistant phrase/);
  assert.match(markdown, /Indexed fixture work/);
  assert.match(markdown, /GPT-5\.6/);

  const jsonDownloadPromise = driverPage.waitForEvent('download');
  await driverPage.locator('#download-json').click();
  const jsonDownload = await jsonDownloadPromise;
  assert.match(jsonDownload.suggestedFilename(), /\.json$/);
  const jsonPath = await jsonDownload.path();
  const exported = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(exported.schema, 'llm-chat-history/archive-export');
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.messages.length, 2);
  assert.equal(exported.messages[1].modelLabel, 'GPT-5.6');
  assert.equal(exported.messages[1].visibleActivities[0].text, 'Indexed fixture work');
});

console.log('\\nAutomated release scenarios PASS: 10/10 deterministic checks.');
console.log('A short authenticated ChatGPT smoke test is still required for provider-DOM compatibility before production release.');
