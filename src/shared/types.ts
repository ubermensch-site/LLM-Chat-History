export type ProviderId = 'chatgpt';
export type TurnRole = 'user' | 'assistant';
export type AdapterHealthState = 'healthy' | 'degraded' | 'error';
export type RecorderState = 'recording' | 'paused' | 'stopped' | 'error';
export type RecorderCommand = 'pause' | 'resume' | 'stop' | 'start';
export type VisibleActivityKind = 'reasoning-summary' | 'tool' | 'status' | 'other';

export interface ProviderConversationIdentity {
  providerId: ProviderId;
  providerConversationId: string | null;
  sourceUrl: string;
  provisional: boolean;
}

export interface ProviderVisibleActivityObservation {
  /** Stable within a rendered provider turn; never derived from hidden/private reasoning. */
  providerActivityId: string;
  kind: VisibleActivityKind;
  /** Text that was visibly rendered by the provider while the response was running. */
  text: string;
  orderHint: number;
  observedAt: string;
}

export interface ProviderTurnObservation {
  providerId: ProviderId;
  providerConversationId: string | null;
  providerTurnId: string;
  providerMessageId: string | null;
  role: TurnRole;
  orderHint: number;
  plainText: string;
  markdown: string | null;
  partial: boolean;
  /** Visible provider UI label only. Never inferred from hidden page data. */
  modelLabel?: string | null;
  /** Visible reasoning summaries, tool/work steps and statuses shown in the provider UI. */
  visibleActivities?: ProviderVisibleActivityObservation[];
  observedAt: string;
}

export interface AdapterHealth {
  state: AdapterHealthState;
  code: string;
  detail?: string;
  observedAt: string;
}

export type ProviderObservation =
  | {
      type: 'conversation';
      identity: ProviderConversationIdentity;
      title: string | null;
      observedAt: string;
    }
  | {
      type: 'turn-upsert';
      turn: ProviderTurnObservation;
    }
  | {
      type: 'turn-snapshot';
      turns: ProviderTurnObservation[];
      observedAt: string;
    }
  | {
      type: 'health';
      health: AdapterHealth;
    };

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  matchesLocation(url: URL): boolean;
  getConversationIdentity(): ProviderConversationIdentity | null;
  getConversationTitle(): string | null;
  scanRenderedTurns(): ProviderTurnObservation[];
  observe(callback: (event: ProviderObservation) => void): () => void;
  getHealth(): AdapterHealth;
}

export interface ContentToBackgroundMessage {
  type: 'LLMCH_PROVIDER_OBSERVATION';
  providerId: ProviderId;
  sourceSessionId: string;
  pageUrl: string;
  observation: ProviderObservation;
}

export interface RecorderCommandMessage {
  type: 'LLMCH_RECORDER_COMMAND';
  requestId: string;
  providerId: ProviderId;
  sourceSessionId: string;
  pageUrl: string;
  identity: ProviderConversationIdentity;
  command: RecorderCommand;
  observedAt: string;
}

export interface CreateCheckpointMessage {
  type: 'LLMCH_CREATE_CHECKPOINT';
  requestId: string;
  providerId: ProviderId;
  sourceSessionId: string;
  pageUrl: string;
  identity: ProviderConversationIdentity;
  name: string;
  note: string | null;
  observedAt: string;
}

export interface OpenLibraryMessage {
  type: 'LLMCH_OPEN_LIBRARY';
}

export interface RefreshMirrorMessage {
  type: 'LLMCH_REFRESH_MIRROR';
  conversationId: string;
}

export interface LiveQaStatusMessage {
  type: 'LLMCH_LIVE_QA_STATUS';
  providerId: ProviderId;
  sourceSessionId: string;
  pageUrl: string;
  identity: ProviderConversationIdentity;
}

export interface LiveQaArchiveStatus {
  conversationFound: boolean;
  messageCount: number;
  eventCount: number;
  recordingState: RecorderState | null;
}

export interface ShowRecorderMessage {
  type: 'LLMCH_SHOW_RECORDER';
}

export type ContentToBackgroundRequest =
  | ContentToBackgroundMessage
  | RecorderCommandMessage
  | CreateCheckpointMessage
  | OpenLibraryMessage
  | RefreshMirrorMessage
  | LiveQaStatusMessage;

export type BackgroundToContentMessage = ShowRecorderMessage;

export interface BackgroundAck {
  ok: boolean;
  error?: string;
  recordingState?: RecorderState;
  persistedAt?: string;
  liveQaStatus?: LiveQaArchiveStatus;
}
