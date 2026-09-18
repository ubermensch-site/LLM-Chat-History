import { conversationDisplayTitle } from '../storage/conversation';
import type { ArchiveProject } from '../storage/schema';
import type { LibraryRecord } from './search';

export type LibraryDateFilter = 'any' | 'today' | '7d' | '30d' | '90d';
export type LibrarySort = 'relevance' | 'newest' | 'oldest' | 'title';

export interface LibraryFilterState {
  providerId: string;
  date: LibraryDateFilter;
  projectId: string;
  folderId: string;
  tag: string;
  sort: LibrarySort;
}

type FilterListener = (state: LibraryFilterState) => void;

const DEFAULT_FILTERS: LibraryFilterState = {
  providerId: 'all',
  date: 'any',
  projectId: 'all',
  folderId: 'all',
  tag: 'all',
  sort: 'relevance'
};

let currentFilters: LibraryFilterState = { ...DEFAULT_FILTERS };
const listeners = new Set<FilterListener>();

export function getLibraryFilters(): LibraryFilterState {
  return { ...currentFilters };
}

export function resetLibraryFilters(): boolean {
  return setLibraryFilters(DEFAULT_FILTERS);
}

export function setLibraryFilters(next: Partial<LibraryFilterState>): boolean {
  const merged: LibraryFilterState = { ...currentFilters, ...next };
  if (
    merged.providerId === currentFilters.providerId &&
    merged.date === currentFilters.date &&
    merged.projectId === currentFilters.projectId &&
    merged.folderId === currentFilters.folderId &&
    merged.tag === currentFilters.tag &&
    merged.sort === currentFilters.sort
  ) {
    return false;
  }

  currentFilters = merged;
  for (const listener of listeners) listener(getLibraryFilters());
  return true;
}

export function subscribeLibraryFilters(listener: FilterListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function activeLibraryFilterCount(state: LibraryFilterState = currentFilters): number {
  return [
    state.providerId !== 'all',
    state.date !== 'any',
    state.projectId !== 'all',
    state.folderId !== 'all',
    state.tag !== 'all'
  ].filter(Boolean).length;
}

export function hasActiveLibraryFilters(state: LibraryFilterState = currentFilters): boolean {
  return activeLibraryFilterCount(state) > 0;
}

function dateThreshold(date: LibraryDateFilter, nowMs: number): number | null {
  const day = 86_400_000;
  if (date === 'any') return null;
  if (date === 'today') {
    const now = new Date(nowMs);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (date === '7d') return nowMs - 7 * day;
  if (date === '30d') return nowMs - 30 * day;
  return nowMs - 90 * day;
}

export function recordMatchesLibraryFilters(
  record: LibraryRecord,
  state: LibraryFilterState,
  nowMs = Date.now()
): boolean {
  const conversation = record.conversation;

  if (state.providerId !== 'all' && conversation.providerId !== state.providerId) return false;

  const threshold = dateThreshold(state.date, nowMs);
  if (threshold !== null) {
    const updatedAt = Date.parse(conversation.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < threshold) return false;
  }

  if (state.projectId !== 'all') {
    if (state.projectId === 'unsorted') {
      if (conversation.projectId) return false;
    } else if (conversation.projectId !== state.projectId) {
      return false;
    }
  }

  if (state.folderId !== 'all' && conversation.folderId !== state.folderId) return false;

  if (state.tag !== 'all') {
    const needle = state.tag.toLocaleLowerCase();
    if (!(conversation.tags ?? []).some((tag) => tag.toLocaleLowerCase() === needle)) return false;
  }

  return true;
}

export function sortLibraryRecords(
  records: readonly LibraryRecord[],
  sort: LibrarySort
): LibraryRecord[] {
  return [...records].sort((a, b) => {
    if (sort === 'oldest') {
      return (
        a.conversation.updatedAt.localeCompare(b.conversation.updatedAt) ||
        a.conversation.id.localeCompare(b.conversation.id)
      );
    }
    if (sort === 'title') {
      return (
        conversationDisplayTitle(a.conversation).localeCompare(
          conversationDisplayTitle(b.conversation),
          undefined,
          { sensitivity: 'base' }
        ) ||
        b.conversation.updatedAt.localeCompare(a.conversation.updatedAt) ||
        a.conversation.id.localeCompare(b.conversation.id)
      );
    }
    return (
      b.conversation.updatedAt.localeCompare(a.conversation.updatedAt) ||
      a.conversation.id.localeCompare(b.conversation.id)
    );
  });
}

export function filterAndSortLibraryRecords(
  records: readonly LibraryRecord[],
  state: LibraryFilterState = currentFilters,
  nowMs = Date.now()
): LibraryRecord[] {
  return sortLibraryRecords(
    records.filter((record) => recordMatchesLibraryFilters(record, state, nowMs)),
    state.sort
  );
}

export function filterProjectLabel(
  projectId: string,
  projects: readonly ArchiveProject[]
): string {
  if (projectId === 'all') return 'All projects';
  if (projectId === 'unsorted') return 'Unsorted';
  return projects.find((project) => project.id === projectId)?.name ?? 'Project';
}

export function filterFolderLabel(
  folderId: string,
  projects: readonly ArchiveProject[]
): string {
  if (folderId === 'all') return 'All folders';
  for (const project of projects) {
    const folder = project.folders.find((entry) => entry.id === folderId);
    if (folder) return folder.name;
  }
  return 'Folder';
}
