export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'llmch.themePreference';

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readThemePreference(): Promise<ThemePreference> {
  return new Promise((resolve) => {
    chrome.storage.local.get(THEME_STORAGE_KEY, (result) => {
      resolve(normalizeThemePreference(result[THEME_STORAGE_KEY]));
    });
  });
}

export function writeThemePreference(preference: ThemePreference): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}
