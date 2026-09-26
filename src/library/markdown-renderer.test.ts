import { describe, expect, it } from 'vitest';
import { renderMarkdownInline, renderMarkdownToSafeHtml } from './markdown-renderer';

describe('Library Markdown renderer', () => {
  it('renders captured headings, emphasis, lists, code, quotes and tables as structured HTML', () => {
    const html = renderMarkdownToSafeHtml(`## Plan

Use **bold** and *emphasis* with \`inline()\`.

- First
- Second
  - Nested

\`\`\`ts
const answer = 42;
\`\`\`

> Quoted line

| Name | Value |
| --- | ---: |
| A | 1 |`);

    expect(html).toContain('<h2>Plan</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<code class="inline-code">inline()</code>');
    expect(html).toContain('<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul>');
    expect(html).toContain('<div class="code-block">');
    expect(html).toContain('<code class="language-ts">const answer = 42;</code>');
    expect(html).toContain('<blockquote><p>Quoted line</p></blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th class="align-left">Name</th>');
    expect(html).toContain('<td class="align-right">1</td>');
  });

  it('escapes raw HTML and refuses executable or relative Markdown links', () => {
    const html = renderMarkdownToSafeHtml(`<script>alert("x")</script>

[Safe](https://example.com/docs)
[Unsafe](javascript:alert(1))
[Relative](/private)`);

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="/private"');
    expect(html).not.toContain('<script>');
  });

  it('restores escaped Markdown punctuation as literal text instead of formatting it', () => {
    expect(renderMarkdownInline('\\# literal \\*stars\\* \\[brackets\\]')).toBe(
      '# literal *stars* [brackets]'
    );
  });

  it('renders image Markdown as a privacy-safe text placeholder rather than a remote image request', () => {
    const html = renderMarkdownToSafeHtml('![Generated chart](https://example.com/private.png)');
    expect(html).toContain('Image: Generated chart');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('private.png');
  });
});
