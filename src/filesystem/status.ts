export const MIRROR_RUNTIME_STATUS_KEY = 'mirrorRuntimeStatus';

export type MirrorRuntimeState =
  | 'disconnected'
  | 'healthy'
  | 'permission-needed'
  | 'denied'
  | 'degraded'
  | 'error';

export interface MirrorRuntimeStatus {
  state: MirrorRuntimeState;
  folderName: string | null;
  conversationId: string | null;
  path: string | null;
  detail: string | null;
  updatedAt: string;
}
