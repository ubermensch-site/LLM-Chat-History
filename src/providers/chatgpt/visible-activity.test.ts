import { describe, expect, it } from 'vitest';
import {
  classifyVisibleActivity,
  hasExplicitVisibleActivitySignal,
  looksLikeVisibleActivityText,
  normalizeVisibleActivityText,
  visibleActivityId
} from './visible-activity';

describe('visible ChatGPT activity capture', () => {
  it('normalizes visible work text without changing its meaning', () => {
    expect(normalizeVisibleActivityText('  Checking   branch…\n\n\n  Fetching files  ')).toBe(
      'Checking branch…\n\nFetching files'
    );
  });

  it('rejects ordinary response controls', () => {
    expect(normalizeVisibleActivityText('Copy')).toBeNull();
    expect(normalizeVisibleActivityText('Read aloud')).toBeNull();
    expect(normalizeVisibleActivityText('Regenerate response')).toBeNull();
  });

  it('recognizes activity wording shown while a response is running', () => {
    expect(looksLikeVisibleActivityText('Thinking')).toBe(true);
    expect(looksLikeVisibleActivityText('Fetched branch files')).toBe(true);
    expect(looksLikeVisibleActivityText('Checking branch and CI workflow runs')).toBe(true);
    expect(looksLikeVisibleActivityText('Here is the final answer.')).toBe(false);
  });

  it('uses semantic DOM signals when wording alone is ambiguous', () => {
    expect(hasExplicitVisibleActivitySignal('data-testid=tool-call')).toBe(true);
    expect(hasExplicitVisibleActivitySignal('aria-label=reasoning details')).toBe(true);
    expect(hasExplicitVisibleActivitySignal('button response action')).toBe(false);
  });

  it('classifies visible reasoning summaries separately from tool/status work', () => {
    expect(classifyVisibleActivity('Thinking', 'reasoning')).toBe('reasoning-summary');
    expect(classifyVisibleActivity('Fetched branch files')).toBe('tool');
    expect(classifyVisibleActivity('Waiting for the complete answer')).toBe('status');
  });

  it('builds deterministic activity IDs without embedding the visible text', () => {
    const first = visibleActivityId('turn-1', 'data-testid:tool-call-1', 0);
    const second = visibleActivityId('turn-1', 'data-testid:tool-call-1', 0);
    expect(first).toBe(second);
    expect(first).toMatch(/^turn-1:visible:0:[a-f0-9]{8}$/);
    expect(first).not.toContain('tool-call-1');
  });
});
