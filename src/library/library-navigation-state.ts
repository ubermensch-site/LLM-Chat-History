import type { ArchiveProject } from '../storage/schema';
import type { LibraryRecord } from './search';

export type LibraryNavigationScope =
  | { kind: 'library' }
  | { kind: 'recent' }
  | { kind: 'archived' }
  | { kind: 'unsorted' }
  | { kind: 'project'; projectId: string }
  | { kind: 'folder'; projectId: string; folderId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'checkpoints' };

export type LibraryNavigationSection =
  | 'library'
  | 'recent'
  | 'projects'
  | 'folders'
  | 'tags'
  | 'checkpoints'
  | 'archived';

export interface NavigationCountItem {
  id: string;
  name: string;
  count: number;
  projectId?: string;
}

export interface LibraryNavigationFacets {
  projects: NavigationCountItem[];
  unsortedCount: number;
  folders: NavigationCountItem[];
  tags: NavigationCountItem[];
  checkpointCount: number;
}

type ScopeListener = (scope: LibraryNavigationScope) => void;

let currentScope: LibraryNavigationScope = { kind: 'library' };
const listeners = new Set<ScopeListener>();

function sameScope(a: LibraryNavigationScope, b: LibraryNavigationScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return a.projectId === b.projectId;
  if (a.kind === 'folder' && b.kind === 'folder') {
    return a.projectId === b.projectId && a.folderId === b.folderId;
  }
  if (a.kind === 'tag' && b.kind === 'tag') {
    return a.tag.toLocaleLowerCase() === b.tag.toLocaleLowerCase();
  }
  return true;
}

export function getLibraryNavigationScope(): LibraryNavigationScope {
  return currentScope;
}

export function setLibraryNavigationScope(scope: LibraryNavigationScope): boolean {
  if (sameScope(currentScope, scope)) return false;
  currentScope = scope;
  for (const listener of listeners) listener(scope);
  return true;
}

export function subscribeLibraryNavigation(listener: ScopeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigationSection(scope: LibraryNavigationScope): LibraryNavigationSection {
  if (scope.kind === 'project' || scope.kind === 'unsorted') return 'projects';
  if (scope.kind === 'folder') return 'folders';
  if (scope.kind === 'tag') return 'tags';
  return scope.kind;
}

export function navigationScopeProjectId(scope: LibraryNavigationScope): string {
  if (scope.kind === 'project' || scope.kind === 'folder') return scope.projectId;
  return scope.kind === 'unsorted' ? 'unsorted' : 'all';
}

export function navigationScopeTitle(
  scope: LibraryNavigationScope,
  projects: readonly ArchiveProject[] = []
): string {
  if (scope.kind === 'library') return 'Library';
  if (scope.kind === 'recent') return 'Recent';
  if (scope.kind === 'archived') return 'Archived';
  if (scope.kind === 'unsorted') return 'Unsorted';
  if (scope.kind === 'checkpoints') return 'Checkpoints';
  if (scope.kind === 'tag') return `#${scope.tag}`;

  const project = projects.find((entry) => entry.id === scope.projectId);
  if (scope.kind === 'project') return project?.name ?? 'Project';

  const folder = project?.folders.find((entry) => entry.id === scope.folderId);
  return folder ? `${project?.name ?? 'Project'} / ${folder.name}` : 'Folder';
}

function activeRecord(record: LibraryRecord): boolean {
  return !record.conversation.archivedAt;
}

export function recordMatchesNavigationScope(
  record: LibraryRecord,
  scope: LibraryNavigationScope
): boolean {
  const conversation = record.conversation;
  if (scope.kind === 'archived') return Boolean(conversation.archivedAt);
  if (!activeRecord(record)) return false;

  if (scope.kind === 'library' || scope.kind === 'recent') return true;
  if (scope.kind === 'unsorted') return !conversation.projectId;
  if (scope.kind === 'project') return conversation.projectId === scope.projectId;
  if (scope.kind === 'folder') {
    return conversation.projectId === scope.projectId && conversation.folderId === scope.folderId;
  }
  if (scope.kind === 'tag') {
    const needle = scope.tag.toLocaleLowerCase();
    return (conversation.tags ?? []).some((tag) => tag.toLocaleLowerCase() === needle);
  }
  return Boolean(record.checkpoints?.length);
}

export function buildNavigationFacets(
  records: readonly LibraryRecord[],
  projects: readonly ArchiveProject[]
): LibraryNavigationFacets {
  const active = records.filter(activeRecord);
  const projectCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  const tags = new Map<string, { name: string; count: number }>();
  let unsortedCount = 0;
  let checkpointCount = 0;

  for (const record of active) {
    const conversation = record.conversation;
    if (conversation.projectId) {
      projectCounts.set(conversation.projectId, (projectCounts.get(conversation.projectId) ?? 0) + 1);
      if (conversation.folderId) {
        const key = `${conversation.projectId}\u0000${conversation.folderId}`;
        folderCounts.set(key, (folderCounts.get(key) ?? 0) + 1);
      }
    } else {
      unsortedCount += 1;
    }

    for (const tag of conversation.tags ?? []) {
      const cleaned = tag.trim();
      if (!cleaned) continue;
      const key = cleaned.toLocaleLowerCase();
      const existing = tags.get(key);
      if (existing) existing.count += 1;
      else tags.set(key, { name: cleaned, count: 1 });
    }

    checkpointCount += record.checkpoints?.length ?? 0;
  }

  const projectItems = projects.map((project) => ({
    id: project.id,
    name: project.name,
    count: projectCounts.get(project.id) ?? 0
  }));

  const folderItems = projects.flatMap((project) =>
    project.folders.map((folder) => ({
      id: folder.id,
      projectId: project.id,
      name: `${project.name} / ${folder.name}`,
      count: folderCounts.get(`${project.id}\u0000${folder.id}`) ?? 0
    }))
  );

  return {
    projects: projectItems,
    unsortedCount,
    folders: folderItems,
    tags: [...tags.entries()]
      .map(([id, value]) => ({ id, name: value.name, count: value.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    checkpointCount
  };
}
