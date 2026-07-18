const DEFAULT_PROVIDER_CALL_TIMEOUT_MS = 120_000;

export function providerCallTimeoutMs(
  raw =
    process.env.PROVIDER_CALL_TIMEOUT_MS ??
    process.env.MODEL_CALL_TIMEOUT_MS,
): number {
  if (!raw) return DEFAULT_PROVIDER_CALL_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROVIDER_CALL_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

export function providerTimeoutMessage(timeoutMs: number): string {
  return `Provider call timed out after ${timeoutMs}ms.`;
}

export function createProviderAbort(timeoutMs = providerCallTimeoutMs()): {
  signal: AbortSignal;
  timeoutMs: number;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(providerTimeoutMessage(timeoutMs)));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timeoutMs,
    clear: () => clearTimeout(timer),
  };
}

export function toProviderError(err: unknown, signal: AbortSignal, timeoutMs: number): unknown {
  if (!signal.aborted) return err;
  const timeoutError = new Error(providerTimeoutMessage(timeoutMs));
  (timeoutError as Error & { cause?: unknown }).cause = err;
  return timeoutError;
}
