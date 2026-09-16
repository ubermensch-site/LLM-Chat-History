import { describe, expect, it } from 'vitest';
import { normalizeThemePreference, resolveTheme } from './theme-preference';

describe('theme preference', () => {
  it('accepts supported saved values and falls back to Auto', () => {
    expect(normalizeThemePreference('system')).toBe('system');
    expect(normalizeThemePreference('light')).toBe('light');
    expect(normalizeThemePreference('dark')).toBe('dark');
    expect(normalizeThemePreference('neon')).toBe('system');
    expect(normalizeThemePreference(undefined)).toBe('system');
  });

  it('follows the computer only in Auto mode', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
