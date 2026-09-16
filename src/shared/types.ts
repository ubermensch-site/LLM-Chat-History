export type ProviderId = 'chatgpt';
export type TurnRole = 'user' | 'assistant';
export type AdapterHealthState = 'healthy' | 'degraded' | 'error';
export type RecorderState = 'recording' | 'paused' | 'stopped' | 'error';
export type RecorderCommand = 'pause' | 'resume' | 'stop' | 'start';

export interface ProviderConversationIdentity {
  providerId: ProviderId;
  providerConversationId: string | null;
  sourceUrl: string;
  provisional: boolean;
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
  providerId: ProviderId;
  sourceSessionId: string;
  pageUrl: string;
  identity: ProviderConversationIdentity;
  command: RecorderCommand;
  observedAt: string;
}

export type ContentToBackgroundRequest = ContentToBackgroundMessage | RecorderCommandMessage;

export interface BackgroundAck {
  ok: boolean;
  error?: string;
  recordingState?: RecorderState;
}
