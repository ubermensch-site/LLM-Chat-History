export interface MarkdownNodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MarkdownNodeLike>;
  getAttribute?: (name: string) => string | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'SVG', 'PATH']);
const BLOCK_CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER']);

function children(node: MarkdownNodeLike): MarkdownNodeLike[] {
  return Array.from(node.childNodes ?? []);
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]<>#>|])/g, '\\$1');
}

function inlineText(value: string): string {
  return escapeMarkdownText(value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' '));
}

function rawText(node: MarkdownNodeLike): string {
  return (node.textContent ?? '').replace(/\u00a0/g, ' ');
}

function safeLinkTarget(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed.replace(/[()\s]/g, (character) => encodeURIComponent(character));
  }
  return null;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function codeFence(value: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
}

function languageForPre(node: MarkdownNodeLike): string {
  const code = children(node).find((child) => child.nodeName.toUpperCase() === 'CODE');
  const className = code?.getAttribute?.('class') ?? '';
  const classMatch = className.match(/(?:^|\s)language-([a-z0-9_+-]+)/i);
  if (classMatch?.[1]) return classMatch[1];
  const dataLanguage = code?.getAttribute?.('data-language') ?? node.getAttribute?.('data-language');
  return dataLanguage?.trim().match(/^[a-z0-9_+-]+$/i)?.[0] ?? '';
}

function renderChildren(node: MarkdownNodeLike): string {
  return children(node).map(renderNode).join('');
}

function normalizeListItem(value: string): string {
  return value.trim().replace(/\s*\n+\s*/g, ' ');
}

function renderList(node: MarkdownNodeLike, ordered: boolean, depth = 0): string {
  const directItems = children(node).filter((child) => child.nodeName.toUpperCase() === 'LI');
  const startValue = Number.parseInt(node.getAttribute?.('start') ?? '1', 10);
  const start = Number.isFinite(startValue) && startValue > 0 ? startValue : 1;
  const indent = '  '.repeat(depth);

  return directItems
    .map((item, index) => {
      const nested = children(item).filter((child) => {
        const tag = child.nodeName.toUpperCase();
        return tag === 'UL' || tag === 'OL';
      });
      const bodyNodeChildren = children(item).filter((child) => !nested.includes(child));
      const body = normalizeListItem(bodyNodeChildren.map(renderNode).join(''));
      const marker = ordered ? `${start + index}.` : '-';
      const nestedMarkdown = nested
        .map((child) => renderList(child, child.nodeName.toUpperCase() === 'OL', depth + 1))
        .filter(Boolean)
        .join('\n');
      return `${indent}${marker} ${body}${nestedMarkdown ? `\n${nestedMarkdown}` : ''}`;
    })
    .join('\n');
}

function collectTableRows(node: MarkdownNodeLike): MarkdownNodeLike[] {
  const rows: MarkdownNodeLike[] = [];
  for (const child of children(node)) {
    const tag = child.nodeName.toUpperCase();
    if (tag === 'TR') rows.push(child);
    else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') rows.push(...collectTableRows(child));
  }
  return rows;
}

function renderTable(node: MarkdownNodeLike): string {
  const rows = collectTableRows(node)
    .map((row) =>
      children(row)
        .filter((cell) => ['TH', 'TD'].includes(cell.nodeName.toUpperCase()))
        .map((cell) => normalizeListItem(renderChildren(cell)).replace(/\|/g, '\\|'))
    )
    .filter((row) => row.length > 0);
  if (!rows.length) return '';

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row: string[]) => [
    ...row,
    ...Array.from({ length: Math.max(0, columnCount - row.length) }, () => '')
  ];
  const header = normalizeRow(rows[0]!);
  const body = rows.slice(1).map(normalizeRow);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`)
  ];
  return `${lines.join('\n')}\n\n`;
}

function renderNode(node: MarkdownNodeLike): string {
  if (node.nodeType === TEXT_NODE) return inlineText(node.textContent ?? '');
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = node.nodeName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return '';

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const value = normalizeListItem(renderChildren(node));
    return value ? `${'#'.repeat(level)} ${value}\n\n` : '';
  }

  switch (tag) {
    case 'BR':
      return '\n';
    case 'P': {
      const value = renderChildren(node).trim();
      return value ? `${value}\n\n` : '';
    }
    case 'STRONG':
    case 'B': {
      const value = renderChildren(node).trim();
      return value ? `**${value}**` : '';
    }
    case 'EM':
    case 'I': {
      const value = renderChildren(node).trim();
      return value ? `*${value}*` : '';
    }
    case 'S':
    case 'DEL': {
      const value = renderChildren(node).trim();
      return value ? `~~${value}~~` : '';
    }
    case 'CODE': {
      const value = rawText(node).trim();
      if (!value) return '';
      const delimiter = '`'.repeat(Math.max(1, longestBacktickRun(value) + 1));
      return `${delimiter}${value}${delimiter}`;
    }
    case 'PRE': {
      const value = rawText(node).replace(/^\n|\n$/g, '');
      if (!value) return '';
      const fence = codeFence(value);
      const language = languageForPre(node);
      return `${fence}${language}\n${value}\n${fence}\n\n`;
    }
    case 'A': {
      const label = renderChildren(node).trim() || inlineText(rawText(node).trim());
      const target = safeLinkTarget(node.getAttribute?.('href') ?? null);
      return target && label ? `[${label}](${target})` : label;
    }
    case 'UL':
      return `${renderList(node, false)}\n\n`;
    case 'OL':
      return `${renderList(node, true)}\n\n`;
    case 'BLOCKQUOTE': {
      const value = renderChildren(node).trim();
      return value ? `${value.split('\n').map((line) => `> ${line}`).join('\n')}\n\n` : '';
    }
    case 'TABLE':
      return renderTable(node);
    case 'HR':
      return '---\n\n';
    case 'IMG': {
      const alt = node.getAttribute?.('alt')?.trim();
      return alt ? `[Image: ${inlineText(alt)}]` : '[Image]';
    }
    default: {
      const value = renderChildren(node);
      if (BLOCK_CONTAINER_TAGS.has(tag)) return value.endsWith('\n') ? value : `${value}\n`;
      return value;
    }
  }
}

export function renderDomAsMarkdown(root: MarkdownNodeLike): string {
  return renderChildren(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
