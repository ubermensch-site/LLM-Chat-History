import { requestToPromise, transactionDone } from './db';
import { STORES, type ArchiveConversation, type ArchiveProject, type ArchiveProjectFolder } from './schema';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectFolderNotFoundError extends Error {
  constructor(folderId: string) {
    super(`Project folder not found: ${folderId}`);
    this.name = 'ProjectFolderNotFoundError';
  }
}

export class OrganizationConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = 'OrganizationConversationNotFoundError';
  }
}

function cleanName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${label} name cannot be empty`);
  return name;
}

function normalizedTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of tags) {
    const tag = value.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, 50);
}

export async function listProjects(db: IDBDatabase): Promise<ArchiveProject[]> {
  const transaction = db.transaction(STORES.projects, 'readonly');
  const projects = await requestToPromise<ArchiveProject[]>(
    transaction.objectStore(STORES.projects).getAll()
  );
  await transactionDone(transaction);
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(
  db: IDBDatabase,
  name: string,
  now = new Date().toISOString()
): Promise<ArchiveProject> {
  const project: ArchiveProject = {
    id: `project:${crypto.randomUUID()}`,
    name: cleanName(name, 'Project'),
    folders: [],
    createdAt: now,
    updatedAt: now
  };
  const transaction = db.transaction(STORES.projects, 'readwrite');
  transaction.objectStore(STORES.projects).add(project);
  await transactionDone(transaction);
  return project;
}

export async function renameProject(
  db: IDBDatabase,
  projectId: string,
  name: string,
  now = new Date().toISOString()
): Promise<ArchiveProject> {
  const transaction = db.transaction(STORES.projects, 'readwrite');
  const store = transaction.objectStore(STORES.projects);
  const project = await requestToPromise<ArchiveProject | undefined>(store.get(projectId));
  if (!project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }
  const updated = { ...project, name: cleanName(name, 'Project'), updatedAt: now };
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function addProjectFolder(
  db: IDBDatabase,
  projectId: string,
  name: string,
  now = new Date().toISOString()
): Promise<{ project: ArchiveProject; folder: ArchiveProjectFolder }> {
  const transaction = db.transaction(STORES.projects, 'readwrite');
  const store = transaction.objectStore(STORES.projects);
  const project = await requestToPromise<ArchiveProject | undefined>(store.get(projectId));
  if (!project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }
  const folder: ArchiveProjectFolder = {
    id: `folder:${crypto.randomUUID()}`,
    name: cleanName(name, 'Folder')
  };
  const updated: ArchiveProject = {
    ...project,
    folders: [...project.folders, folder],
    updatedAt: now
  };
  store.put(updated);
  await transactionDone(transaction);
  return { project: updated, folder };
}

export async function renameProjectFolder(
  db: IDBDatabase,
  projectId: string,
  folderId: string,
  name: string,
  now = new Date().toISOString()
): Promise<ArchiveProject> {
  const transaction = db.transaction(STORES.projects, 'readwrite');
  const store = transaction.objectStore(STORES.projects);
  const project = await requestToPromise<ArchiveProject | undefined>(store.get(projectId));
  if (!project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }
  if (!project.folders.some((folder) => folder.id === folderId)) {
    transaction.abort();
    throw new ProjectFolderNotFoundError(folderId);
  }
  const updated: ArchiveProject = {
    ...project,
    folders: project.folders.map((folder) =>
      folder.id === folderId ? { ...folder, name: cleanName(name, 'Folder') } : folder
    ),
    updatedAt: now
  };
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function deleteProjectFolder(
  db: IDBDatabase,
  projectId: string,
  folderId: string,
  now = new Date().toISOString()
): Promise<void> {
  const transaction = db.transaction([STORES.projects, STORES.conversations], 'readwrite');
  const projects = transaction.objectStore(STORES.projects);
  const conversations = transaction.objectStore(STORES.conversations);
  const [project, allConversations] = await Promise.all([
    requestToPromise<ArchiveProject | undefined>(projects.get(projectId)),
    requestToPromise<ArchiveConversation[]>(conversations.getAll())
  ]);
  if (!project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }
  if (!project.folders.some((folder) => folder.id === folderId)) {
    transaction.abort();
    throw new ProjectFolderNotFoundError(folderId);
  }

  projects.put({
    ...project,
    folders: project.folders.filter((folder) => folder.id !== folderId),
    updatedAt: now
  } satisfies ArchiveProject);

  for (const conversation of allConversations) {
    if (conversation.projectId !== projectId || conversation.folderId !== folderId) continue;
    const updated: ArchiveConversation = { ...conversation, updatedAt: now };
    delete updated.folderId;
    conversations.put(updated);
  }
  await transactionDone(transaction);
}

export async function deleteProject(
  db: IDBDatabase,
  projectId: string,
  now = new Date().toISOString()
): Promise<void> {
  const transaction = db.transaction([STORES.projects, STORES.conversations], 'readwrite');
  const projects = transaction.objectStore(STORES.projects);
  const conversations = transaction.objectStore(STORES.conversations);
  const [project, allConversations] = await Promise.all([
    requestToPromise<ArchiveProject | undefined>(projects.get(projectId)),
    requestToPromise<ArchiveConversation[]>(conversations.getAll())
  ]);
  if (!project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }

  projects.delete(projectId);
  for (const conversation of allConversations) {
    if (conversation.projectId !== projectId) continue;
    const updated: ArchiveConversation = { ...conversation, updatedAt: now };
    delete updated.projectId;
    delete updated.folderId;
    conversations.put(updated);
  }
  await transactionDone(transaction);
}

export async function assignConversationOrganization(
  db: IDBDatabase,
  conversationId: string,
  projectId: string | null,
  folderId: string | null,
  now = new Date().toISOString()
): Promise<ArchiveConversation> {
  if (!projectId && folderId) throw new Error('A folder cannot be assigned without a project');

  const transaction = db.transaction([STORES.projects, STORES.conversations], 'readwrite');
  const projects = transaction.objectStore(STORES.projects);
  const conversations = transaction.objectStore(STORES.conversations);
  const conversationRequest = conversations.get(conversationId);
  const projectRequest = projectId ? projects.get(projectId) : null;
  const [conversation, project] = await Promise.all([
    requestToPromise<ArchiveConversation | undefined>(conversationRequest),
    projectRequest
      ? requestToPromise<ArchiveProject | undefined>(projectRequest)
      : Promise.resolve(undefined)
  ]);
  if (!conversation) {
    transaction.abort();
    throw new OrganizationConversationNotFoundError(conversationId);
  }
  if (projectId && !project) {
    transaction.abort();
    throw new ProjectNotFoundError(projectId);
  }
  if (folderId && !project?.folders.some((folder) => folder.id === folderId)) {
    transaction.abort();
    throw new ProjectFolderNotFoundError(folderId);
  }

  const updated: ArchiveConversation = { ...conversation, updatedAt: now };
  if (projectId) updated.projectId = projectId;
  else delete updated.projectId;
  if (folderId) updated.folderId = folderId;
  else delete updated.folderId;
  conversations.put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function setConversationTags(
  db: IDBDatabase,
  conversationId: string,
  tags: string[],
  now = new Date().toISOString()
): Promise<ArchiveConversation> {
  const transaction = db.transaction(STORES.conversations, 'readwrite');
  const store = transaction.objectStore(STORES.conversations);
  const conversation = await requestToPromise<ArchiveConversation | undefined>(store.get(conversationId));
  if (!conversation) {
    transaction.abort();
    throw new OrganizationConversationNotFoundError(conversationId);
  }
  const normalized = normalizedTags(tags);
  const updated: ArchiveConversation = { ...conversation, updatedAt: now };
  if (normalized.length) updated.tags = normalized;
  else delete updated.tags;
  store.put(updated);
  await transactionDone(transaction);
  return updated;
}
