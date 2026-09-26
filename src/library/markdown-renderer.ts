export type MarkdownInlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInlineNode[] }
  | { type: 'emphasis'; children: MarkdownInlineNode[] }
  | { type: 'delete'; children: MarkdownInlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; target: string; children: MarkdownInlineNode[] }
  | { type: 'image-placeholder'; alt: MarkdownInlineNode[] };

export type MarkdownAlignment = 'left' | 'center' | 'right';

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInlineNode[] }
  | { type: 'heading'; level: number; children: MarkdownInlineNode[] }
  | {
      type: 'list';
      ordered: boolean;
      start: number;
      items: Array<{ children: MarkdownInlineNode[]; nested: MarkdownBlock[] }>;
    }
  | { type: 'code-block'; language: string; value: string }
  | { type: 'blockquote'; children: MarkdownBlock[] }
  | {
      type: 'table';
      alignments: MarkdownAlignment[];
      headers: MarkdownInlineNode[][];
      rows: MarkdownInlineNode[][][];
    }
  | { type: 'rule' };

function safeLinkTarget(value: string): string | null {
  const target = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(target) ? target : null;
}

function findUnescaped(source: string, needle: string, from: number): number {
  for (let index = from; index <= source.length - needle.length; index += 1) {
    if (source.slice(index, index + needle.length) !== needle) continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) return index;
  }
  return -1;
}

function backtickRun(source: string, start: number): number {
  let length = 0;
  while (source[start + length] === '`') length += 1;
  return length;
}

function findClosingParen(source: string, from: number): number {
  let depth = 1;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === '(') {
      depth += 1;
      continue;
    }
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function pushText(nodes: MarkdownInlineNode[], value: string): void {
  if (!value) return;
  const previous = nodes.at(-1);
  if (previous?.type === 'text') previous.value += value;
  else nodes.push({ type: 'text', value });
}

export function parseMarkdownInline(source: string): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;

    if (character === '\\' && index + 1 < source.length) {
      pushText(nodes, source[index + 1]!);
      index += 2;
      continue;
    }

    if (character === '`') {
      const runLength = backtickRun(source, index);
      const delimiter = '`'.repeat(runLength);
      const closing = findUnescaped(source, delimiter, index + runLength);
      if (closing !== -1) {
        nodes.push({
          type: 'code',
          value: source.slice(index + runLength, closing).replace(/^ | $/g, '')
        });
        index = closing + runLength;
        continue;
      }
    }

    if (source.startsWith('![', index)) {
      const labelEnd = findUnescaped(source, ']', index + 2);
      if (labelEnd !== -1 && source[labelEnd + 1] === '(') {
        const targetEnd = findClosingParen(source, labelEnd + 2);
        if (targetEnd !== -1) {
          nodes.push({
            type: 'image-placeholder',
            alt: parseMarkdownInline(source.slice(index + 2, labelEnd))
          });
          index = targetEnd + 1;
          continue;
        }
      }
    }

    if (character === '[') {
      const labelEnd = findUnescaped(source, ']', index + 1);
      if (labelEnd !== -1 && source[labelEnd + 1] === '(') {
        const targetEnd = findClosingParen(source, labelEnd + 2);
        if (targetEnd !== -1) {
          const label = parseMarkdownInline(source.slice(index + 1, labelEnd));
          const target = safeLinkTarget(source.slice(labelEnd + 2, targetEnd));
          if (target) nodes.push({ type: 'link', target, children: label });
          else nodes.push(...label);
          index = targetEnd + 1;
          continue;
        }
      }
    }

    const strongDelimiter =
      source.startsWith('**', index) ? '**' : source.startsWith('__', index) ? '__' : null;
    if (strongDelimiter) {
      const closing = findUnescaped(source, strongDelimiter, index + 2);
      if (closing !== -1) {
        nodes.push({
          type: 'strong',
          children: parseMarkdownInline(source.slice(index + 2, closing))
        });
        index = closing + 2;
        continue;
      }
    }

    if (source.startsWith('~~', index)) {
      const closing = findUnescaped(source, '~~', index + 2);
      if (closing !== -1) {
        nodes.push({
          type: 'delete',
          children: parseMarkdownInline(source.slice(index + 2, closing))
        });
        index = closing + 2;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const closing = findUnescaped(source, character, index + 1);
      if (closing !== -1) {
        nodes.push({
          type: 'emphasis',
          children: parseMarkdownInline(source.slice(index + 1, closing))
        });
        index = closing + 1;
        continue;
      }
    }

    pushText(nodes, character);
    index += 1;
  }

  return nodes;
}

interface ListLine {
  indent: number;
  ordered: boolean;
  number: number;
  body: string;
}

function parseListLine(line: string): ListLine | null {
  const match = line.match(/^(\s*)([-+*]|(\d+)\.)\s+(.+)$/);
  if (!match) return null;
  const whitespace = (match[1] ?? '').replace(/\t/g, '    ');
  return {
    indent: whitespace.length,
    ordered: Boolean(match[3]),
    number: match[3] ? Number.parseInt(match[3], 10) : 1,
    body: match[4] ?? ''
  };
}

function parseList(
  lines: string[],
  start: number,
  baseIndent: number
): { block: Extract<MarkdownBlock, { type: 'list' }>; next: number } {
  const first = parseListLine(lines[start] ?? '');
  if (!first) {
    return {
      block: { type: 'list', ordered: false, start: 1, items: [] },
      next: start + 1
    };
  }

  const ordered = first.ordered;
  const block: Extract<MarkdownBlock, { type: 'list' }> = {
    type: 'list',
    ordered,
    start: first.number,
    items: []
  };
  let index = start;

  while (index < lines.length) {
    const current = parseListLine(lines[index] ?? '');
    if (!current || current.indent !== baseIndent || current.ordered !== ordered) break;

    const item = {
      children: parseMarkdownInline(current.body.trim()),
      nested: [] as MarkdownBlock[]
    };
    index += 1;

    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (!line.trim()) {
        index += 1;
        break;
      }

      const nextList = parseListLine(line);
      if (nextList) {
        if (nextList.indent > baseIndent) {
          const child = parseList(lines, index, nextList.indent);
          item.nested.push(child.block);
          index = child.next;
          continue;
        }
        break;
      }

      if (/^\s+/.test(line)) {
        pushText(item.children, ` ${line.trim()}`);
        index += 1;
        continue;
      }
      break;
    }

    block.items.push(item);
  }

  return { block, next: index };
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '\\' && value[index + 1] === '|') {
      cell += '\\|';
      index += 1;
      continue;
    }
    if (character === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(separator: string): MarkdownAlignment[] | null {
  const cells = splitTableRow(separator);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.trim()))) return null;
  return cells.map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
}

function isHorizontalRule(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, '');
  return compact === '---' || compact === '***' || compact === '___';
}

function fenceMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s*([\`~]{3,})([a-z0-9_+-]*)\s*$/i);
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (fenceMatch(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (parseListLine(line)) return true;
  if (index + 1 < lines.length && tableAlignments(lines[index + 1] ?? '')) return true;
  return false;
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = fenceMatch(line);
    if (fence) {
      const delimiter = fence[1]!;
      const fenceCharacter = delimiter[0]!;
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = (lines[index] ?? '').trim();
        const closesFence =
          candidate.length >= delimiter.length &&
          [...candidate].every((character) => character === fenceCharacter);
        if (closesFence) {
          index += 1;
          break;
        }
        body.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ type: 'code-block', language, value: body.join('\n') });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        children: parseMarkdownInline(heading[2] ?? '')
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdown(quote.join('\n')) });
      continue;
    }

    const alignments =
      index + 1 < lines.length ? tableAlignments(lines[index + 1] ?? '') : null;
    if (alignments) {
      const headers = splitTableRow(line).map(parseMarkdownInline);
      const rows: MarkdownInlineNode[][][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? '';
        if (!row.trim() || !row.includes('|')) break;
        rows.push(splitTableRow(row).map(parseMarkdownInline));
        index += 1;
      }
      blocks.push({ type: 'table', alignments, headers, rows });
      continue;
    }

    const list = parseListLine(line);
    if (list) {
      const rendered = parseList(lines, index, list.indent);
      blocks.push(rendered.block);
      index = rendered.next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      children: parseMarkdownInline(paragraph.join(' '))
    });
  }

  return blocks;
}

function appendInline(parent: HTMLElement, nodes: readonly MarkdownInlineNode[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      parent.append(document.createTextNode(node.value));
      continue;
    }

    if (node.type === 'code') {
      const code = document.createElement('code');
      code.className = 'inline-code';
      code.textContent = node.value;
      parent.append(code);
      continue;
    }

    if (node.type === 'image-placeholder') {
      const placeholder = document.createElement('span');
      placeholder.className = 'markdown-image-placeholder';
      placeholder.append(document.createTextNode('Image: '));
      appendInline(placeholder, node.alt);
      parent.append(placeholder);
      continue;
    }

    if (node.type === 'link') {
      const link = document.createElement('a');
      link.href = node.target;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      appendInline(link, node.children);
      parent.append(link);
      continue;
    }

    const element =
      node.type === 'strong'
        ? document.createElement('strong')
        : node.type === 'emphasis'
          ? document.createElement('em')
          : document.createElement('del');

    appendInline(element, node.children);
    parent.append(element);
  }
}

function appendBlock(parent: HTMLElement, block: MarkdownBlock): void {
  if (block.type === 'paragraph') {
    const paragraph = document.createElement('p');
    appendInline(paragraph, block.children);
    parent.append(paragraph);
    return;
  }

  if (block.type === 'heading') {
    const heading = document.createElement(`h${Math.min(6, Math.max(1, block.level))}`);
    appendInline(heading, block.children);
    parent.append(heading);
    return;
  }

  if (block.type === 'rule') {
    parent.append(document.createElement('hr'));
    return;
  }

  if (block.type === 'blockquote') {
    const quote = document.createElement('blockquote');
    for (const child of block.children) appendBlock(quote, child);
    parent.append(quote);
    return;
  }

  if (block.type === 'code-block') {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';

    if (block.language) {
      const label = document.createElement('div');
      label.className = 'code-block-label';
      label.textContent = block.language;
      wrapper.append(label);
    }

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (block.language) code.className = `language-${block.language}`;
    code.textContent = block.value;
    pre.append(code);
    wrapper.append(pre);
    parent.append(wrapper);
    return;
  }

  if (block.type === 'list') {
    const list = block.ordered ? document.createElement('ol') : document.createElement('ul');
    if (block.ordered && block.start !== 1) {
      (list as HTMLOListElement).start = block.start;
    }
    for (const item of block.items) {
      const entry = document.createElement('li');
      appendInline(entry, item.children);
      for (const nested of item.nested) appendBlock(entry, nested);
      list.append(entry);
    }
    parent.append(list);
    return;
  }

  const scroll = document.createElement('div');
  scroll.className = 'markdown-table-scroll';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const columnCount = Math.max(block.headers.length, block.alignments.length);

  for (let column = 0; column < columnCount; column += 1) {
    const th = document.createElement('th');
    th.className = `align-${block.alignments[column] ?? 'left'}`;
    appendInline(th, block.headers[column] ?? []);
    headerRow.append(th);
  }

  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of block.rows) {
    const tr = document.createElement('tr');
    for (let column = 0; column < columnCount; column += 1) {
      const td = document.createElement('td');
      td.className = `align-${block.alignments[column] ?? 'left'}`;
      appendInline(td, row[column] ?? []);
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(tbody);
  scroll.append(table);
  parent.append(scroll);
}

export function renderMarkdownInto(container: HTMLElement, markdown: string): void {
  container.replaceChildren();
  for (const block of parseMarkdown(markdown)) appendBlock(container, block);
}
