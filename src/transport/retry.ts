export interface RetryOptions {
  maxAttempts?: number;
  delaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const delaysMs = options.delaysMs ?? [150, 400];
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
      const delay = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      if (delay > 0) await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
