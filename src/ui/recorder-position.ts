export interface RecorderPosition {
  x: number;
  y: number;
}

export const RECORDER_POSITION_STORAGE_KEY = 'llmch.recorderPosition';

export function normalizeRecorderPosition(value: unknown): RecorderPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<RecorderPosition>;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return null;
  return { x: Number(candidate.x), y: Number(candidate.y) };
}

export function clampRecorderPosition(
  position: RecorderPosition,
  elementWidth: number,
  elementHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8
): RecorderPosition {
  const maxX = Math.max(padding, viewportWidth - elementWidth - padding);
  const maxY = Math.max(padding, viewportHeight - elementHeight - padding);
  return {
    x: Math.min(maxX, Math.max(padding, position.x)),
    y: Math.min(maxY, Math.max(padding, position.y))
  };
}
