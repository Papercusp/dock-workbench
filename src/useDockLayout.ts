import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockLayoutRow, DockLayoutStore } from './store';

export type DockLayoutState =
  | { status: 'loading'; row: null; error: null }
  | { status: 'ready'; row: DockLayoutRow; error: null }
  | { status: 'error'; row: DockLayoutRow | null; error: Error };

export interface UseDockLayoutOptions {
  /**
   * Backoff delays (ms) before each RETRY of the initial load. The first load
   * is attempt 0; a failure waits `retryDelaysMs[0]` then retries, etc. Only
   * after the final retry fails does the hook surface the `error` state.
   *
   * This exists because the layout `load` is a network fetch, and in a desktop
   * webview a transient blip (operator restart / HMR reload / a momentary
   * connection drop) rejects it with a bare "Load failed" — which, without
   * retry, blanked the entire dock behind an error wall for what was really a
   * sub-second hiccup. A short bounded backoff lets those self-heal while still
   * surfacing a genuine, persistent failure. Default: `[150, 400, 900]`.
   */
  retryDelaysMs?: number[];
}

const DEFAULT_LOAD_RETRY_DELAYS_MS = [150, 400, 900];

function shouldRetryLoad(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // HTTP responses from createFetchDockLayoutStore are explicit, actionable
  // server results. Retry only transport-style failures that match the desktop
  // restart/HMR blip this backoff was added for.
  if (/→\s*\d{3}\b/.test(msg)) return false;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(msg);
}

export interface UseDockLayoutResult {
  state: DockLayoutState;
  save: (layout: DockLayoutRow['layoutJson'], opts?: { force?: boolean }) => Promise<DockLayoutRow>;
  reset: () => Promise<DockLayoutRow>;
  refresh: () => Promise<DockLayoutRow>;
}

export function useDockLayout(
  name: string,
  store: DockLayoutStore,
  opts?: UseDockLayoutOptions,
): UseDockLayoutResult {
  const [state, setState] = useState<DockLayoutState>({ status: 'loading', row: null, error: null });
  const rowRef = useRef<DockLayoutRow | null>(null);
  const retryDelaysMs = opts?.retryDelaysMs ?? DEFAULT_LOAD_RETRY_DELAYS_MS;
  // Snapshot the delays into a ref so the load effect doesn't re-run when a
  // caller passes a fresh array literal each render.
  const retryRef = useRef(retryDelaysMs);
  retryRef.current = retryDelaysMs;

  const fetchOnce = useCallback(async (): Promise<DockLayoutRow> => {
    const row = await store.load(name);
    rowRef.current = row;
    return row;
  }, [name, store]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', row: null, error: null });

    void (async () => {
      const delays = retryRef.current;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (cancelled) return;
        try {
          const row = await fetchOnce();
          if (!cancelled) setState({ status: 'ready', row, error: null });
          return;
        } catch (err) {
          lastErr = err as Error;
          // Wait out the backoff before the next retry (no wait after the last).
          if (attempt < delays.length && shouldRetryLoad(err)) {
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          } else {
            break;
          }
        }
      }
      if (!cancelled) {
        setState({ status: 'error', row: null, error: lastErr ?? new Error('layout load failed') });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchOnce]);

  const refresh = useCallback(async (): Promise<DockLayoutRow> => {
    const row = await fetchOnce();
    setState({ status: 'ready', row, error: null });
    return row;
  }, [fetchOnce]);

  const save = useCallback(
    async (layout: DockLayoutRow['layoutJson'], opts: { force?: boolean } = {}): Promise<DockLayoutRow> => {
      const row = await store.save(name, layout, {
        force: opts.force,
        expectedUpdatedTs: rowRef.current?.updatedTs,
      });
      rowRef.current = row;
      setState({ status: 'ready', row, error: null });
      return row;
    },
    [name, store],
  );

  const reset = useCallback(async (): Promise<DockLayoutRow> => {
    const row = await store.reset(name);
    rowRef.current = row;
    setState({ status: 'ready', row, error: null });
    return row;
  }, [name, store]);

  return { state, save, reset, refresh };
}
