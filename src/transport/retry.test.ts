import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
  it('retries transient failures and returns the eventual result', async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn<[(attempt: number)], Promise<string>>()
      .mockRejectedValueOnce(new Error('worker asleep'))
      .mockResolvedValue('ok');

    await expect(
      withRetry(operation, { maxAttempts: 3, delaysMs: [10, 20], sleep })
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('does not retry a successful delivery', async () => {
    const operation = vi.fn(async () => 'ok');
    await expect(withRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('surfaces the final error after the configured attempts', async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn(async () => {
      throw new Error('still unavailable');
    });

    await expect(
      withRetry(operation, { maxAttempts: 3, delaysMs: [0, 0], sleep })
    ).rejects.toThrow('still unavailable');
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
