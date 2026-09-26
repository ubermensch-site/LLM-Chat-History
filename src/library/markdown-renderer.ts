function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLinkTarget(value: string): string | null {
  const target = value.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(target)) return null;
  return target;
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

export function renderMarkdownInline(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;

    if (character === '\\' && index + 1 < source.length) {
      output += escapeHtml(source[index + 1]!);
      index += 2;
      continue;
    }

    if (character === '`') {
      const runLength = backtickRun(source, index);
      const delimiter = '`'.repeat(runLength);
      const closing = findUnescaped(source, delimiter, index + runLength);
      if (closing !== -1) {
        const code = source.slice(index + runLength, closing).replace(/^ | $/g, '');
        output += `<code class="inline-code">${escapeHtml(code)}</code>`;
        index = closing + runLength;
        continue;
      }
    }

    if (source.startsWith('![', index)) {
      const labelEnd = findUnescaped(source, ']', index + 2);
      if (labelEnd !== -1 && source[labelEnd + 1] === '(') {
        const targetEnd = findUnescaped(source, ')', labelEnd + 2);
        if (targetEnd !== -1) {
          const alt = source.slice(index + 2, labelEnd);
          output += `<span class="markdown-image-placeholder">Image: ${renderMarkdownInline(alt)}</span>`;
          index = targetEnd + 1;
          continue;
        }
      }
    }

    if (character === '[') {
      const labelEnd = findUnescaped(source, ']', index + 1);
      if (labelEnd !== -1 && source[labelEnd + 1] === '(') {
        const targetEnd = findUnescaped(source, ')', labelEnd + 2);
        if (targetEnd !== -1) {
          const label = source.slice(index + 1, labelEnd);
          const rawTarget = source.slice(labelEnd + 2, targetEnd);
          const target = safeLinkTarget(rawTarget);
          if (target) {
            output += `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${renderMarkdownInline(label)}</a>`;
          } else {
            output += renderMarkdownInline(label);
          }
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
        output += `<strong>${renderMarkdownInline(source.slice(index + 2, closing))}</strong>`;
        index = closing + 2;
        continue;
      }
    }

    if (source.startsWith('~~', index)) {
      const closing = findUnescaped(source, '~~', index + 2);
      if (closing !== -1) {
        output += `<del>${renderMarkdownInline(source.slice(index + 2, closing))}</del>`;
        index = closing + 2;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const closing = findUnescaped(source, character, index + 1);
      if (closing !== -1) {
        output += `<em>${renderMarkdownInline(source.slice(index + 1, closing))}</em>`;
        index = closing + 1;
        continue;
      }
    }

    output += escapeHtml(character);
    index += 1;
  }

  return output;
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

function renderList(lines: string[], start: number, baseIndent: number): { html: string; next: number } {
  const first = parseListLine(lines[start] ?? '');
  if (!first) return { html: '', next: start + 1 };

  const ordered = first.ordered;
  const startAttribute = ordered && first.number !== 1 ? ` start="${first.number}"` : '';
  const tag = ordered ? 'ol' : 'ul';
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const current = parseListLine(lines[index] ?? '');
    if (!current || current.indent < baseIndent) break;
    if (current.indent > baseIndent) break;
    if (current.ordered !== ordered) break;

    let body = renderMarkdownInline(current.body.trim());
    let nested = '';
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
          const child = renderList(lines, index, nextList.indent);
          nested += child.html;
          index = child.next;
          continue;
        }
        break;
      }

      if (/^\s+/.test(line)) {
        body += ` ${renderMarkdownInline(line.trim())}`;
        index += 1;
        continue;
      }
      break;
    }

    items.push(`<li>${body}${nested}</li>`);
  }

  return {
    html: `<${tag}${startAttribute}>${items.join('')}</${tag}>`,
    next: index
  };
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

function tableAlignments(separator: string): Array<'left' | 'center' | 'right'> | null {
  const cells = splitTableRow(separator);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.trim()))) return null;
  return cells.map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
}

function renderTable(headerLine: string, separatorLine: string, bodyLines: string[]): string {
  const alignments = tableAlignments(separatorLine);
  if (!alignments) return '';
  const headers = splitTableRow(headerLine);
  const body = bodyLines.map(splitTableRow);
  const columnCount = Math.max(headers.length, alignments.length);

  const cellClass = (index: number) => ` class="align-${alignments[index] ?? 'left'}"`;
  const headHtml = Array.from({ length: columnCount }, (_, index) =>
    `<th${cellClass(index)}>${renderMarkdownInline(headers[index] ?? '')}</th>`
  ).join('');

  const bodyHtml = body
    .map(
      (row) =>
        `<tr>${Array.from({ length: columnCount }, (_, index) =>
          `<td${cellClass(index)}>${renderMarkdownInline(row[index] ?? '')}</td>`
        ).join('')}</tr>`
    )
    .join('');

  return `<div class="markdown-table-scroll"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function isHorizontalRule(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, '');
  return compact === '---' || compact === '***' || compact === '___';
}

function isFence(line: string): RegExpMatchArray | null {
  return line.match(/^\s*([\`~]{3,})([a-z0-9_+-]*)\s*$/i);
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (isFence(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (parseListLine(line)) return true;
  if (index + 1 < lines.length && tableAlignments(lines[index + 1] ?? '')) return true;
  return false;
}

export function renderMarkdownToSafeHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      const delimiter = fence[1]!;
      const fenceCharacter = delimiter[0]!;
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = (lines[index] ?? '').trim();
        const closing = new RegExp(`^${fenceCharacter}{${delimiter.length},}\\s*$`).test(candidate);
        if (closing) {
          index += 1;
          break;
        }
        body.push(lines[index] ?? '');
        index += 1;
      }

      const languageLabel = language
        ? `<div class="code-block-label">${escapeHtml(language)}</div>`
        : '';
      blocks.push(
        `<div class="code-block">${languageLabel}<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre></div>`
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderMarkdownInline(heading[2] ?? '')}</h${level}>`);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdownToSafeHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    if (index + 1 < lines.length && tableAlignments(lines[index + 1] ?? '')) {
      const headerLine = line;
      const separatorLine = lines[index + 1] ?? '';
      const bodyLines: string[] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? '';
        if (!row.trim() || !row.includes('|')) break;
        bodyLines.push(row);
        index += 1;
      }
      blocks.push(renderTable(headerLine, separatorLine, bodyLines));
      continue;
    }

    const list = parseListLine(line);
    if (list) {
      const rendered = renderList(lines, index, list.indent);
      blocks.push(rendered.html);
      index = rendered.next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`);
  }

  return blocks.filter(Boolean).join('\n');
}
