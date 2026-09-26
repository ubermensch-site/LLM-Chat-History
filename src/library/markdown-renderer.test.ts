import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseMarkdownInline } from './markdown-renderer';

describe('Library Markdown renderer', () => {
  it('parses captured headings, emphasis, lists, code, quotes and tables into structured blocks', () => {
    const blocks = parseMarkdown(`## Plan

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

    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'strong' }),
        expect.objectContaining({ type: 'emphasis' }),
        expect.objectContaining({ type: 'code', value: 'inline()' })
      ])
    });
    expect(blocks[2]).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        expect.objectContaining({ nested: [] }),
        expect.objectContaining({
          nested: [expect.objectContaining({ type: 'list', ordered: false })]
        })
      ]
    });
    expect(blocks[3]).toMatchObject({
      type: 'code-block',
      language: 'ts',
      value: 'const answer = 42;'
    });
    expect(blocks[4]).toMatchObject({ type: 'blockquote' });
    expect(blocks[5]).toMatchObject({
      type: 'table',
      alignments: ['left', 'right']
    });
  });

  it('keeps raw HTML as text and refuses executable or relative Markdown links', () => {
    const blocks = parseMarkdown(`<script>alert("x")</script>

[Safe](https://example.com/docs)
[Unsafe](javascript:alert(1))
[Relative](/private)`);

    expect(blocks[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', value: '<script>alert("x")</script>' }]
    });

    const safe = blocks[1];
    expect(safe).toMatchObject({
      type: 'paragraph',
      children: [expect.objectContaining({ type: 'link', target: 'https://example.com/docs' })]
    });

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toContain('"target":"javascript:');
    expect(serialized).not.toContain('"target":"/private"');
  });

  it('restores escaped Markdown punctuation as literal text instead of formatting it', () => {
    expect(parseMarkdownInline('\\# literal \\*stars\\* \\[brackets\\]')).toEqual([
      { type: 'text', value: '# literal *stars* [brackets]' }
    ]);
  });

  it('turns image Markdown into a privacy-safe placeholder without retaining the remote source', () => {
    const blocks = parseMarkdown('![Generated chart](https://example.com/private.png)');
    expect(blocks).toMatchObject([
      {
        type: 'paragraph',
        children: [
          {
            type: 'image-placeholder',
            alt: [{ type: 'text', value: 'Generated chart' }]
          }
        ]
      }
    ]);
    expect(JSON.stringify(blocks)).not.toContain('private.png');
  });
});
