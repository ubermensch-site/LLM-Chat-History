import { describe, expect, it } from 'vitest';
import { conversationPreviewText } from './conversation-preview';

describe('conversationPreviewText', () => {
  it('uses Markdown block boundaries to produce readable preview spacing', () => {
    expect(
      conversationPreviewText(
        'unique searchable assistant phrase\n\n## Reader structure\n\nStructured **Markdown** should stay readable.',
        'unique searchable assistant phraseReader structureStructured Markdown should stay readable.',
        200
      )
    ).toBe(
      'unique searchable assistant phrase Reader structure Structured Markdown should stay readable.'
    );
  });

  it('removes common presentation syntax while retaining useful text', () => {
    expect(
      conversationPreviewText(
        '- [x] Verify release\n- [ ] Ship build\n\n[Docs](https://example.com) and `code`',
        null
      )
    ).toBe('Verify release Ship build Docs and code');
  });

  it('truncates on a nearby word boundary', () => {
    expect(
      conversationPreviewText(
        'This is a deliberately long preview string that should stop on a readable word boundary.',
        null,
        42
      )
    ).toBe('This is a deliberately long preview…');
  });

  it('falls back to plain text and then an empty-state label', () => {
    expect(conversationPreviewText(null, '  Plain   text  ')).toBe('Plain text');
    expect(conversationPreviewText(null, null)).toBe('No message preview yet');
  });
});
