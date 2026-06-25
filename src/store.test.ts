import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createLocalStorageDockLayoutStore,
  createFetchDockLayoutStore,
  DockLayoutConflictError,
} from './store';
import { CURRENT_LAYOUT_SCHEMA_VERSION, type LayoutDoc } from './layout';

const seedDoc = (): LayoutDoc => ({
  schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
  root: { kind: 'tabs', id: 't', activePanelId: 'p1', panels: [{ id: 'p1', type: 'a' }] },
});

/** Minimal in-memory localStorage so the store suite runs in the `node` env. */
function installMemoryLocalStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  });
}

describe('createLocalStorageDockLayoutStore', () => {
  beforeEach(() => installMemoryLocalStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('seeds and persists on first load (a miss)', async () => {
    const seed = vi.fn(seedDoc);
    const store = createLocalStorageDockLayoutStore({ keyPrefix: 'k', seed });
    const row = await store.load('main');
    expect(seed).toHaveBeenCalledOnce();
    expect(row.layoutName).toBe('main');
    expect(row.layoutJson).toEqual(seedDoc());
    // a second load is a hit: the seed is not called again
    await store.load('main');
    expect(seed).toHaveBeenCalledOnce();
  });

  it('saves a new layout and reads it back', async () => {
    const store = createLocalStorageDockLayoutStore({ keyPrefix: 'k', seed: seedDoc });
    await store.load('main');
    const next: LayoutDoc = {
      schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
      root: { kind: 'tabs', id: 't2', activePanelId: 'q1', panels: [{ id: 'q1', type: 'b' }] },
    };
    const saved = await store.save('main', next);
    expect(saved.layoutJson).toEqual(next);
    const reloaded = await store.load('main');
    expect(reloaded.layoutJson).toEqual(next);
  });

  it('rejects an invalid layout on save', async () => {
    const store = createLocalStorageDockLayoutStore({ keyPrefix: 'k', seed: seedDoc });
    await expect(store.save('main', { schemaVersion: 1 } as unknown as LayoutDoc)).rejects.toThrow(/LayoutValidationError/);
  });

  it('enforces optimistic concurrency via expectedUpdatedTs', async () => {
    const store = createLocalStorageDockLayoutStore({ keyPrefix: 'k', seed: seedDoc });
    const row = await store.load('main');
    // a stale expectedUpdatedTs → conflict
    await expect(store.save('main', seedDoc(), { expectedUpdatedTs: row.updatedTs - 1 })).rejects.toBeInstanceOf(
      DockLayoutConflictError,
    );
    // force overrides the check
    await expect(store.save('main', seedDoc(), { expectedUpdatedTs: row.updatedTs - 1, force: true })).resolves.toBeTruthy();
  });

  it('reset clears the stored row and re-seeds on the next load', async () => {
    const seed = vi.fn(seedDoc);
    const store = createLocalStorageDockLayoutStore({ keyPrefix: 'k', seed });
    await store.load('main');
    await store.save('main', {
      schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
      root: { kind: 'tabs', id: 'z', activePanelId: 'z1', panels: [{ id: 'z1', type: 'c' }] },
    });
    const afterReset = await store.reset('main');
    expect(afterReset.layoutJson).toEqual(seedDoc());
    expect(seed).toHaveBeenCalledTimes(2); // initial load + reset's re-seed
  });
});

describe('createFetchDockLayoutStore', () => {
  const row = {
    workspaceId: 'w',
    userId: 'u',
    layoutName: 'adv:papercusp',
    schemaVersion: 1,
    layoutJson: seedDoc(),
    createdTs: 1,
    updatedTs: 2,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('GETs the url-encoded layout name on load', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => row });
    const store = createFetchDockLayoutStore('/api/dock-layouts');
    const got = await store.load('adv:papercusp');
    expect(fetchMock).toHaveBeenCalledWith('/api/dock-layouts/adv%3Apapercusp');
    expect(got.layoutName).toBe('adv:papercusp');
  });

  it('throws a descriptive error on a non-ok load', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    const store = createFetchDockLayoutStore();
    await expect(store.load('x')).rejects.toThrow(/→ 500: boom/);
  });

  it('PUTs the layout body on save and sends if-match when expectedUpdatedTs is given', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => row });
    const store = createFetchDockLayoutStore();
    await store.save('adv:papercusp', seedDoc(), { expectedUpdatedTs: 7 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['if-match']).toBe('7');
    expect(JSON.parse(init.body)).toEqual({ layout: seedDoc() });
  });

  it('maps a 409 to DockLayoutConflictError', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, text: async () => '' });
    const store = createFetchDockLayoutStore();
    await expect(store.save('x', seedDoc())).rejects.toBeInstanceOf(DockLayoutConflictError);
  });

  it('reset DELETEs then reloads', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 204 }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => row }); // subsequent load
    const store = createFetchDockLayoutStore();
    const got = await store.reset('adv:papercusp');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(got.layoutName).toBe('adv:papercusp');
  });
});
