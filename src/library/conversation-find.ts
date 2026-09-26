export interface TextMatchRange {
  start: number;
  end: number;
}

export function findTextRanges(value: string, query: string): TextMatchRange[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const haystack = value.toLocaleLowerCase();
  const matches: TextMatchRange[] = [];
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, offset);
    if (start === -1) break;
    matches.push({ start, end: start + needle.length });
    offset = start + Math.max(needle.length, 1);
  }

  return matches;
}
