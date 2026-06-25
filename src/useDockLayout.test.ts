import { describe, it, expect, vi } from 'vitest';
import { shouldRetryLoad, attemptLayoutLoad } from './useDockLayout';

describe('shouldRetryLoad', () => {
  it('retries bare transport failures (the desktop-webview blip)', () => {
    expect(shouldRetryLoad(new TypeError('Load failed'))).toBe(true);
    expect(shouldRetryLoad(new Error('Load failed'))).toBe(true);
    expect(shouldRetryLoad(new Error('Failed to fetch'))).toBe(true);
    expect(shouldRetryLoad(new Error('NetworkError when attempting to fetch resource'))).toBe(true);
    expect(shouldRetryLoad(new Error('Network request failed'))).toBe(true);
  });

  it('does NOT retry an explicit HTTP response from the fetch store', () => {
    expect(shouldRetryLoad(new Error('GET /api/dock-layouts/x → 500: boom'))).toBe(false);
    expect(shouldRetryLoad(new Error('GET /api/dock-layouts/x → 404: '))).toBe(false);
  });

  it('does NOT retry an unrelated error', () => {
    expect(shouldRetryLoad(new Error('LayoutValidationError: bad root'))).toBe(false);
    expect(shouldRetryLoad('weird')).toBe(false);
  });
});

describe('attemptLayoutLoad', () => {
  const noSleep = vi.fn(async () => {});

  it('returns the row on a first-try success without sleeping', async () => {
    const load = vi.fn(async () => 'ok');
    await expect(attemptLayoutLoad(load, [1, 1, 1], noSleep)).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const load = vi.fn(async () => {
      n++;
      if (n < 3) throw new TypeError('Load failed');
      return 'recovered';
    });
    await expect(attemptLayoutLoad(load, [5, 5, 5], sleep)).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // backoff before attempts 2 and 3
  });

  it('gives up after exhausting retries and throws the last transient error', async () => {
    const sleep = vi.fn(async () => {});
    const load = vi.fn(async () => {
      throw new TypeError('Load failed');
    });
    await expect(attemptLayoutLoad(load, [5, 5], sleep)).rejects.toThrow(/Load failed/);
    expect(load).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-transient (HTTP) failure — fails fast', async () => {
    const sleep = vi.fn(async () => {});
    const load = vi.fn(async () => {
      throw new Error('GET /api/dock-layouts/x → 500: boom');
    });
    await expect(attemptLayoutLoad(load, [5, 5, 5], sleep)).rejects.toThrow(/→ 500/);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
