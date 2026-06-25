import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview';
import 'dockview-react/dist/styles/dockview.css';
import { isWellFormedLayout, type LayoutDoc } from './layout';
import { toDockviewJson, toLayoutDoc, type DockviewLayout } from './layout-adapter';
import { panelRegistry as defaultRegistry, type PanelComponent, type PanelComponentProps, type PanelRegistry } from './panel-registry';
import { DockLayoutConflictError, type DockLayoutStore } from './store';
import { useDockLayout } from './useDockLayout';

export interface DockWorkspaceProps {
  layoutName: string;
  store: DockLayoutStore;
  registry?: PanelRegistry;
  className?: string;
  resetEventName?: string;
  loadEventName?: string;
  missingComponent?: PanelComponent;
  canClosePanel?: (panelId: string) => Promise<boolean> | boolean;
  onApiReady?: (api: DockviewApi) => void;
  onApiDispose?: () => void;
  onPanelRemoved?: (panelId: string) => void;
  onSaveError?: (error: Error) => void;
  renderError?: (error: Error, actions: { retry: () => void; reset: () => void }) => ReactElement;
}

function DefaultMissingPanel({ panelType }: PanelComponentProps) {
  return (
    <div style={{ padding: 12, color: 'var(--fg-mute, #888)', font: '12px system-ui, sans-serif' }}>
      Missing panel: <code>{panelType}</code>
    </div>
  );
}

function makeBridge(type: string, registry: PanelRegistry, Missing: PanelComponent, canClose?: DockWorkspaceProps['canClosePanel']) {
  function Bridge(dvProps: IDockviewPanelProps<Record<string, unknown>>) {
    const { api, params } = dvProps;
    const panelProps: PanelComponentProps = useMemo(
      () => ({
        panelId: api.id,
        panelType: type,
        params: (params ?? {}) as Record<string, unknown>,
        api: {
          setParams: (next) => api.updateParameters(next),
          setTitle: (t) => api.setTitle(t),
          close: () => {
            Promise.resolve(canClose ? canClose(api.id) : true).then((ok) => {
              if (ok) api.close();
            });
          },
        },
      }),
      [api, params],
    );

    const entry = registry.get(type);
    const Real = entry?.component ?? Missing;
    return <Real {...panelProps} />;
  }
  Bridge.displayName = `PanelBridge(${type})`;
  return Bridge;
}

function collectTypes(doc: LayoutDoc, into: Set<string>): void {
  function walk(n: LayoutDoc['root'] | null | undefined): void {
    if (!n) return;
    if (n.kind === 'tabs') {
      for (const p of n.panels ?? []) into.add(p.type);
    } else {
      for (const c of n.children ?? []) walk(c);
    }
  }
  walk(doc.root);
  for (const f of doc.floating ?? []) {
    for (const p of f.panels ?? []) into.add(p.type);
  }
}

function useComponentsForLayout(
  layout: LayoutDoc | null,
  registry: PanelRegistry,
  Missing: PanelComponent,
  canClose?: DockWorkspaceProps['canClosePanel'],
): Record<string, PanelComponent> {
  const [registryTick, setRegistryTick] = useState(0);
  useEffect(() => registry.subscribe(() => setRegistryTick((t) => t + 1)), [registry]);

  return useMemo(() => {
    void registryTick;
    const types = new Set<string>();
    if (layout) collectTypes(layout, types);
    for (const t of registry.list()) types.add(t);
    types.add('__missing__');
    const map: Record<string, PanelComponent> = {};
    for (const t of types) {
      map[t] = makeBridge(t, registry, Missing, canClose) as unknown as PanelComponent;
    }
    return map;
  }, [layout, registry, registryTick, Missing, canClose]);
}

export function DockWorkspace({
  layoutName: initialLayoutName,
  store,
  registry = defaultRegistry,
  className,
  resetEventName,
  loadEventName,
  missingComponent = DefaultMissingPanel,
  canClosePanel,
  onApiReady,
  onApiDispose,
  onPanelRemoved,
  onSaveError,
  renderError,
}: DockWorkspaceProps) {
  const [activeLayoutName, setActiveLayoutName] = useState(initialLayoutName);
  useEffect(() => setActiveLayoutName(initialLayoutName), [initialLayoutName]);

  const { state, save, reset, refresh } = useDockLayout(activeLayoutName, store);
  const apiRef = useRef<DockviewApi | null>(null);
  const restoredOnceRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rawLayout = state.status === 'ready' && state.row.schemaVersion === 1 ? (state.row.layoutJson as LayoutDoc) : null;
  const layoutDoc = isWellFormedLayout(rawLayout) ? rawLayout : null;
  const malformedRow = rawLayout !== null && layoutDoc === null;
  const components = useComponentsForLayout(layoutDoc, registry, missingComponent, canClosePanel);

  const recoveredTsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!malformedRow || state.status !== 'ready') return;
    const ts = state.row.updatedTs;
    if (recoveredTsRef.current === ts) return;
    recoveredTsRef.current = ts;
    const t = setTimeout(() => void refresh(), 300);
    return () => clearTimeout(t);
  }, [malformedRow, state, refresh]);

  useEffect(() => {
    if (restoredOnceRef.current) return;
    if (!apiRef.current || !layoutDoc) return;
    try {
      apiRef.current.fromJSON(toDockviewJson(layoutDoc) as unknown as Parameters<DockviewApi['fromJSON']>[0]);
      restoredOnceRef.current = true;
    } catch (err) {
      console.error('[DockWorkspace] hydrate failed:', err);
    }
  }, [layoutDoc]);

  const persist = useCallback(() => {
    if (!apiRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const dv = apiRef.current?.toJSON() as unknown as DockviewLayout | undefined;
      if (!dv) return;
      const doc = toLayoutDoc(dv);
      if (!isWellFormedLayout(doc)) return;
      save(doc).catch((err: Error & { conflict?: boolean }) => {
        if (err instanceof DockLayoutConflictError || err.conflict) return;
        onSaveError?.(err);
        if (!onSaveError) console.warn('[DockWorkspace] save failed:', err.message);
      });
    }, 800);
  }, [save, onSaveError]);

  const [apiReady, setApiReady] = useState(false);
  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      onApiReady?.(event.api);
      setApiReady(true);
    },
    [onApiReady],
  );

  useEffect(() => {
    if (!apiReady || !apiRef.current) return;
    const api = apiRef.current;
    const disposables = [
      api.onDidLayoutChange(persist),
      api.onDidAddPanel(persist),
      api.onDidRemovePanel((panel) => {
        persist();
        onPanelRemoved?.(panel.id);
      }),
    ];
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [apiReady, persist, onPanelRemoved]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      onApiDispose?.();
    };
  }, [onApiDispose]);

  useEffect(() => {
    if (!resetEventName && !loadEventName) return;
    const onResetLayout = () => {
      restoredOnceRef.current = false;
      void reset().catch((err) => console.error('[DockWorkspace] reset failed:', err));
    };
    const onLoadLayout = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string }>).detail;
      if (detail?.name && typeof detail.name === 'string') {
        restoredOnceRef.current = false;
        setActiveLayoutName(detail.name);
      }
    };
    if (resetEventName) window.addEventListener(resetEventName, onResetLayout);
    if (loadEventName) window.addEventListener(loadEventName, onLoadLayout);
    return () => {
      if (resetEventName) window.removeEventListener(resetEventName, onResetLayout);
      if (loadEventName) window.removeEventListener(loadEventName, onLoadLayout);
    };
  }, [reset, resetEventName, loadEventName]);

  if (state.status === 'error') {
    const retry = () => void refresh();
    const resetLayout = () => {
      restoredOnceRef.current = false;
      void reset();
    };
    if (renderError) return renderError(state.error, { retry, reset: resetLayout });
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', fontSize: 13 }}>
        <div style={{ color: 'var(--bad, #f85149)' }}>
          Failed to load layout <code>{activeLayoutName}</code>: {state.error.message}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={retry}>Retry</button>
          <button type="button" onClick={resetLayout}>Reset to default</button>
        </div>
      </div>
    );
  }

  return (
    <DockviewReact
      onReady={onReady}
      components={components as unknown as Parameters<typeof DockviewReact>[0]['components']}
      className={className ?? 'dockview-theme-dark'}
    />
  );
}
