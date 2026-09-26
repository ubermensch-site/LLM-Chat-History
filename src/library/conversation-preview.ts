export function conversationPreviewText(
  markdown: string | null | undefined,
  plainText: string | null | undefined,
  maxLength = 92
): string {
  const source = markdown?.trim() || plainText?.trim() || '';
  if (!source) return 'No message preview yet';

  const normalized = source
    .replace(/^\s*```[a-z0-9_+-]*\s*$/gim, ' ')
    .replace(/^\s*```\s*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/`([^\`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'No message preview yet';
  if (normalized.length <= maxLength) return normalized;

  const target = Math.max(1, maxLength - 1);
  const slice = normalized.slice(0, target);
  const lastSpace = slice.lastIndexOf(' ');
  const safeCut = lastSpace >= Math.floor(target * 0.65) ? lastSpace : target;
  return `${slice.slice(0, safeCut).trimEnd()}…`;
}
