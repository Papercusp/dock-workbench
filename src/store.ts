import { validateLayoutDoc, type LayoutDoc } from './layout';

export interface DockLayoutRow {
  workspaceId?: string;
  userId?: string;
  layoutName: string;
  schemaVersion: number;
  layoutJson: LayoutDoc | { schemaVersion: 0; [k: string]: unknown };
  updatedTs: number;
  createdTs: number;
}

export interface DockLayoutStore {
  load(name: string): Promise<DockLayoutRow>;
  save(name: string, layout: DockLayoutRow['layoutJson'], opts?: { expectedUpdatedTs?: number; force?: boolean }): Promise<DockLayoutRow>;
  reset(name: string): Promise<DockLayoutRow>;
}

export class DockLayoutConflictError extends Error {
  conflict = true;

  constructor(name: string) {
    super(`409 conflict for ${name}`);
    this.name = 'DockLayoutConflictError';
  }
}

export function createFetchDockLayoutStore(basePath = '/api/dock-layouts'): DockLayoutStore {
  const pathFor = (name: string) => `${basePath.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
  return {
    async load(name) {
      const resp = await fetch(pathFor(name));
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`GET ${pathFor(name)} → ${resp.status}: ${text}`);
      }
      return normalizeRow(await resp.json());
    },
    async save(name, layout, opts = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (!opts.force && typeof opts.expectedUpdatedTs === 'number') {
        headers['if-match'] = String(opts.expectedUpdatedTs);
      }
      const resp = await fetch(pathFor(name), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ layout }),
      });
      if (resp.status === 409) throw new DockLayoutConflictError(name);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`PUT ${pathFor(name)} → ${resp.status}: ${text}`);
      }
      return normalizeRow(await resp.json());
    },
    async reset(name) {
      const resp = await fetch(pathFor(name), { method: 'DELETE' });
      if (!resp.ok && resp.status !== 204) {
        const text = await resp.text().catch(() => '');
        throw new Error(`DELETE ${pathFor(name)} → ${resp.status}: ${text}`);
      }
      return this.load(name);
    },
  };
}

export function createLocalStorageDockLayoutStore(opts: {
  keyPrefix: string;
  seed: (name: string) => LayoutDoc;
  workspaceId?: string;
  userId?: string;
}): DockLayoutStore {
  const keyFor = (name: string) => `${opts.keyPrefix}:${name}`;
  const rowFrom = (name: string, layout: LayoutDoc, createdTs = Date.now()): DockLayoutRow => ({
    workspaceId: opts.workspaceId ?? 'local',
    userId: opts.userId ?? 'local',
    layoutName: name,
    schemaVersion: layout.schemaVersion,
    layoutJson: layout,
    createdTs,
    updatedTs: Date.now(),
  });
  return {
    async load(name) {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(keyFor(name)) : null;
      if (raw) {
        const row = normalizeRow(JSON.parse(raw));
        validateLayoutDoc(row.layoutJson);
        return row;
      }
      const row = rowFrom(name, opts.seed(name));
      if (typeof localStorage !== 'undefined') localStorage.setItem(keyFor(name), JSON.stringify(row));
      return row;
    },
    async save(name, layout, saveOpts = {}) {
      validateLayoutDoc(layout);
      const existing = await this.load(name);
      if (!saveOpts.force && typeof saveOpts.expectedUpdatedTs === 'number' && existing.updatedTs !== saveOpts.expectedUpdatedTs) {
        throw new DockLayoutConflictError(name);
      }
      const row = {
        ...existing,
        schemaVersion: layout.schemaVersion,
        layoutJson: layout,
        updatedTs: Date.now(),
      };
      if (typeof localStorage !== 'undefined') localStorage.setItem(keyFor(name), JSON.stringify(row));
      return row;
    },
    async reset(name) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(keyFor(name));
      return this.load(name);
    },
  };
}

function normalizeRow(raw: unknown): DockLayoutRow {
  const row = raw as DockLayoutRow;
  if (typeof (row as { layoutJson?: unknown }).layoutJson === 'string') {
    row.layoutJson = JSON.parse((row as unknown as { layoutJson: string }).layoutJson);
  }
  return row;
}
