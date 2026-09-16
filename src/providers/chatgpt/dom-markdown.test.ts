import { describe, expect, it } from 'vitest';
import { renderDomAsMarkdown, type MarkdownNodeLike } from './dom-markdown';

function text(value: string): MarkdownNodeLike {
  return {
    nodeType: 3,
    nodeName: '#text',
    textContent: value,
    childNodes: []
  };
}

function element(
  name: string,
  attributes: Record<string, string> = {},
  ...childNodes: MarkdownNodeLike[]
): MarkdownNodeLike {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: childNodes.map((child) => child.textContent ?? '').join(''),
    childNodes,
    getAttribute(attribute) {
      return attributes[attribute] ?? null;
    }
  };
}

describe('ChatGPT DOM to Markdown capture', () => {
  it('preserves common semantic formatting without HTML serialization', () => {
    const root = element(
      'div',
      {},
      element('h2', {}, text('Plan')),
      element(
        'p',
        {},
        text('Use '),
        element('strong', {}, text('bold')),
        text(' and '),
        element('em', {}, text('emphasis')),
        text('.')
      ),
      element(
        'ul',
        {},
        element('li', {}, text('First')),
        element('li', {}, text('Second'), element('ul', {}, element('li', {}, text('Nested'))))
      ),
      element('pre', {}, element('code', { class: 'language-ts' }, text('const answer = `42`;'))),
      element('blockquote', {}, element('p', {}, text('Quoted line'))),
      element(
        'table',
        {},
        element(
          'thead',
          {},
          element('tr', {}, element('th', {}, text('Name')), element('th', {}, text('Value')))
        ),
        element(
          'tbody',
          {},
          element('tr', {}, element('td', {}, text('A')), element('td', {}, text('1')))
        )
      )
    );

    const markdown = renderDomAsMarkdown(root);
    expect(markdown).toContain('## Plan');
    expect(markdown).toContain('Use **bold** and *emphasis*.');
    expect(markdown).toContain('- First');
    expect(markdown).toContain('- Second');
    expect(markdown).toContain('  - Nested');
    expect(markdown).toContain('```ts\nconst answer = `42`;\n```');
    expect(markdown).toContain('> Quoted line');
    expect(markdown).toContain('| Name | Value |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| A | 1 |');
  });

  it('preserves safe links but drops executable/relative link targets', () => {
    const root = element(
      'div',
      {},
      element('p', {}, element('a', { href: 'https://example.com/docs' }, text('Docs'))),
      element('p', {}, element('a', { href: 'javascript:alert(1)' }, text('Unsafe'))),
      element('p', {}, element('a', { href: '/relative/private' }, text('Relative')))
    );

    const markdown = renderDomAsMarkdown(root);
    expect(markdown).toContain('[Docs](https://example.com/docs)');
    expect(markdown).toContain('Unsafe');
    expect(markdown).toContain('Relative');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).not.toContain('/relative/private');
  });

  it('escapes literal Markdown control text and skips provider UI controls', () => {
    const root = element(
      'div',
      {},
      element('p', {}, text('# literal *stars* [brackets] <tag> | pipe')),
      element('button', {}, text('Copy SECRET CONTROL')),
      element('svg', {}, text('SECRET SVG'))
    );
    const markdown = renderDomAsMarkdown(root);
    expect(markdown).toContain('\\# literal \\*stars\\* \\[brackets\\] \\<tag\\> \\| pipe');
    expect(markdown).not.toContain('SECRET CONTROL');
    expect(markdown).not.toContain('SECRET SVG');
  });

  it('uses longer code fences when code contains backtick runs', () => {
    const root = element(
      'div',
      {},
      element('pre', {}, element('code', {}, text('before ``` inside after')))
    );
    const markdown = renderDomAsMarkdown(root);
    expect(markdown).toBe('````\nbefore ``` inside after\n````');
  });

  it('uses image alt text without exporting remote image sources', () => {
    const root = element(
      'div',
      {},
      element('img', { alt: 'Generated chart', src: 'https://example.com/private-image.png' })
    );
    const markdown = renderDomAsMarkdown(root);
    expect(markdown).toBe('[Image: Generated chart]');
    expect(markdown).not.toContain('private-image');
  });
});
