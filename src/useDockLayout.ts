import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockLayoutRow, DockLayoutStore } from './store';

export type DockLayoutState =
  | { status: 'loading'; row: null; error: null }
  | { status: 'ready'; row: DockLayoutRow; error: null }
  | { status: 'error'; row: DockLayoutRow | null; error: Error };

export interface UseDockLayoutResult {
  state: DockLayoutState;
  save: (layout: DockLayoutRow['layoutJson'], opts?: { force?: boolean }) => Promise<DockLayoutRow>;
  reset: () => Promise<DockLayoutRow>;
  refresh: () => Promise<DockLayoutRow>;
}

export function useDockLayout(name: string, store: DockLayoutStore): UseDockLayoutResult {
  const [state, setState] = useState<DockLayoutState>({ status: 'loading', row: null, error: null });
  const rowRef = useRef<DockLayoutRow | null>(null);

  const fetchOnce = useCallback(async (): Promise<DockLayoutRow> => {
    const row = await store.load(name);
    rowRef.current = row;
    return row;
  }, [name, store]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', row: null, error: null });
    fetchOnce()
      .then((row) => {
        if (!cancelled) setState({ status: 'ready', row, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'error', row: null, error: err });
      });
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
