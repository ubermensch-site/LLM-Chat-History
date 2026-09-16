import type { VisibleActivityKind } from '../../shared/types';

const ACTION_PREFIX = /^(?:thinking|thought\b|reasoning|search(?:ing|ed)?|brows(?:ing|ed)?|read(?:ing)?|check(?:ing|ed)?|fetc[h](?:ing|ed)?|open(?:ing|ed)?|run(?:ning|ran)?|analy[sz](?:ing|ed)?|writ(?:ing|ten|e)|edit(?:ing|ed)?|updat(?:ing|ed)|creat(?:ing|ed)|implement(?:ing|ed)?|test(?:ing|ed)?|build(?:ing|built)?|verif(?:ying|ied)|download(?:ing|ed)?|upload(?:ing|ed)?|inspect(?:ing|ed)?|compar(?:ing|ed)|generat(?:ing|ed)|sav(?:ing|ed)|us(?:ing|ed)|call(?:ing|ed)?|load(?:ing|ed)?|connect(?:ing|ed)?|prepar(?:ing|ed)|process(?:ing|ed)?|work(?:ing|ed)?|wait(?:ing|ed)?|retry(?:ing|ied)?|continu(?:ing|ed)|looking up|looked up)\b/i;

const EXCLUDED_CONTROL_TEXT = new Set([
  'copy',
  'copy code',
  'edit',
  'share',
  'retry',
  'regenerate',
  'regenerate response',
  'read aloud',
  'good response',
  'bad response',
  'more',
  'stop generating',
  'continue generating',
  'branch',
  'new chat'
]);

export function normalizeVisibleActivityText(value: string): string | null {
  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized || normalized.length > 4_000) return null;
  if (EXCLUDED_CONTROL_TEXT.has(normalized.toLocaleLowerCase())) return null;
  return normalized;
}

export function hasExplicitVisibleActivitySignal(signal: string): boolean {
  return /(?:think|reason|tool|status|progress|search|browse|research|analysis|computer|terminal|python|code|file|command|task|work)/i.test(
    signal
  );
}

export function looksLikeVisibleActivityText(text: string): boolean {
  return ACTION_PREFIX.test(text.trim());
}

export function classifyVisibleActivity(text: string, signal = ''): VisibleActivityKind {
  const combined = `${signal} ${text}`;
  if (/(?:think|thought|reason)/i.test(combined)) return 'reasoning-summary';
  if (
    /(?:tool|search|browse|research|computer|terminal|python|code|file|command|branch|fetch|read|open|run|write|edit|update|implement|test|build|verify|download|upload|inspect|compare|generate|save|call)/i.test(
      combined
    )
  ) {
    return 'tool';
  }
  if (/(?:status|progress|working|waiting|retry|continue|prepare|process|load|connect)/i.test(combined)) {
    return 'status';
  }
  return 'other';
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function visibleActivityId(
  providerTurnId: string,
  domKey: string,
  orderHint: number
): string {
  return `${providerTurnId}:visible:${orderHint}:${fnv1a32(domKey)}`;
}
