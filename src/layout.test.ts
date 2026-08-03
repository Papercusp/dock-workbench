import { describe, it, expect } from 'vitest';
import {
  validateLayoutDoc,
  isWellFormedLayout,
  collectPanelTypes,
  isLayoutEntirelyUnregistered,
  LayoutValidationError,
  CURRENT_LAYOUT_SCHEMA_VERSION,
  OPAQUE_SCHEMA_VERSION,
  type LayoutDoc,
} from './layout';

const wellFormed: LayoutDoc = {
  schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
  root: {
    kind: 'group',
    id: 'root',
    direction: 'row',
    children: [
      {
        kind: 'tabs',
        id: 't1',
        activePanelId: 'p1',
        panels: [
          { id: 'p1', type: 'a' },
          { id: 'p2', type: 'b' },
        ],
      },
    ],
  },
};

describe('validateLayoutDoc', () => {
  it('accepts a well-formed current-version layout', () => {
    expect(() => validateLayoutDoc(wellFormed)).not.toThrow();
  });

  it('passes through an opaque (schemaVersion 0) blob without inspecting it', () => {
    expect(() => validateLayoutDoc({ schemaVersion: OPAQUE_SCHEMA_VERSION, anything: 'goes' })).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => validateLayoutDoc(null)).toThrow(LayoutValidationError);
    expect(() => validateLayoutDoc(42)).toThrow(LayoutValidationError);
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => validateLayoutDoc({ schemaVersion: 99, root: wellFormed.root })).toThrow(/unsupported schemaVersion 99/);
  });

  it('requires a root', () => {
    expect(() => validateLayoutDoc({ schemaVersion: 1 })).toThrow(/layout\.root required/);
  });

  it('rejects a group missing children', () => {
    expect(() =>
      validateLayoutDoc({ schemaVersion: 1, root: { kind: 'group', id: 'g' } }),
    ).toThrow(/missing children/);
  });

  it('rejects a tabs whose activePanelId is not among its panels', () => {
    expect(() =>
      validateLayoutDoc({
        schemaVersion: 1,
        root: { kind: 'tabs', id: 't', activePanelId: 'nope', panels: [{ id: 'p1', type: 'a' }] },
      }),
    ).toThrow(/activePanelId nope not in panels/);
  });

  it('rejects a panel missing a type', () => {
    expect(() =>
      validateLayoutDoc({
        schemaVersion: 1,
        root: { kind: 'tabs', id: 't', activePanelId: 'p1', panels: [{ id: 'p1' }] },
      }),
    ).toThrow(/missing type/);
  });

  it('rejects an unknown node kind', () => {
    expect(() =>
      validateLayoutDoc({ schemaVersion: 1, root: { kind: 'wat', id: 'x' } }),
    ).toThrow(/unknown node kind/);
  });

  it('rejects non-array floating', () => {
    expect(() => validateLayoutDoc({ ...wellFormed, floating: {} })).toThrow(/floating must be array/);
  });

  it('validates floating group geometry', () => {
    const bad = {
      ...wellFormed,
      floating: [{ id: 'f', x: 'nope', y: 0, width: 1, height: 1, panels: [], activePanelId: '' }],
    };
    expect(() => validateLayoutDoc(bad)).toThrow(/bad x\/y/);
  });
});

describe('isWellFormedLayout', () => {
  it('is true for a current-version layout', () => {
    expect(isWellFormedLayout(wellFormed)).toBe(true);
  });

  it('is false for an opaque blob (must be the current version, not passthrough)', () => {
    expect(isWellFormedLayout({ schemaVersion: OPAQUE_SCHEMA_VERSION })).toBe(false);
  });

  it('is false for malformed input, without throwing', () => {
    expect(isWellFormedLayout(null)).toBe(false);
    expect(isWellFormedLayout({ schemaVersion: 1, root: { kind: 'group', id: 'g' } })).toBe(false);
  });
});

describe('collectPanelTypes', () => {
  it('collects docked types across nested groups', () => {
    expect([...collectPanelTypes(wellFormed)].sort()).toEqual(['a', 'b']);
  });

  it('includes floating-group panels, which a root-only walk would miss', () => {
    const doc: LayoutDoc = {
      ...wellFormed,
      floating: [
        { id: 'f1', x: 0, y: 0, width: 10, height: 10, activePanelId: 'fp1', panels: [{ id: 'fp1', type: 'floater' }] },
      ],
    };
    expect([...collectPanelTypes(doc)].sort()).toEqual(['a', 'b', 'floater']);
  });
});

describe('isLayoutEntirelyUnregistered', () => {
  /** Build a single-tab layout over the given panel types. */
  const layoutOf = (...types: string[]): LayoutDoc => ({
    schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
    root: {
      kind: 'tabs',
      id: 't',
      activePanelId: 'p0',
      panels: types.map((type, i) => ({ id: `p${i}`, type })),
    },
  });
  const registered =
    (...types: string[]) =>
    (t: string) =>
      types.includes(t);
  const pluginDeferred = (t: string) => t.startsWith('plugin:');

  // CASE 1 — the filed bug (EI-19425275400158684). A persisted
  // `adv-harnesses3:<slug>` row held only retired legacy-dashboard types, so the
  // Work tab rendered 5 "not installed" placeholders and zero panes.
  it('is DEAD when every type is unregistered and none may load later', () => {
    const retired = layoutOf('data:git', 'view:harness-overview', 'data:features', 'data:issues', 'data:logs');
    expect(isLayoutEntirelyUnregistered(retired, registered('adv:work-items', 'adv:dep-graph'), pluginDeferred)).toBe(
      true,
    );
  });

  // CASE 2 — the regression guard for the correction. This is the case a naive
  // "nothing registered ⇒ reseed" rule breaks: plugin panels register
  // asynchronously, so during a slow /api/plugins fetch a VALID layout looks
  // exactly like a dead one. Reseeding here would destroy real user state
  // intermittently, under load — a worse bug than the one being fixed.
  it('is NOT dead when the only unregistered types may still be registering', () => {
    const pluginsOnly = layoutOf('plugin:acme:board', 'plugin:acme:chart');
    expect(isLayoutEntirelyUnregistered(pluginsOnly, registered(), pluginDeferred)).toBe(false);
  });

  it('is DEAD for those same plugin types when the host declares no deferred types', () => {
    // Guards the exemption's direction: it is the DEFERRAL that rescues the
    // layout, not anything intrinsic to the `plugin:` string.
    expect(isLayoutEntirelyUnregistered(layoutOf('plugin:acme:board'), registered())).toBe(true);
  });

  // CASE 3 — a partly-dead layout keeps its placeholders. Its live panes still
  // work; silently discarding the user's arrangement is worse than a visible,
  // recoverable placeholder.
  it('is NOT dead when at least one type is registered', () => {
    const mixed = layoutOf('data:git', 'adv:work-items');
    expect(isLayoutEntirelyUnregistered(mixed, registered('adv:work-items'), pluginDeferred)).toBe(false);
  });

  it('is NOT dead for an empty layout — nothing has gone stale', () => {
    const empty: LayoutDoc = {
      schemaVersion: CURRENT_LAYOUT_SCHEMA_VERSION,
      root: { kind: 'tabs', id: 't', activePanelId: '', panels: [] },
    };
    expect(isLayoutEntirelyUnregistered(empty, registered(), pluginDeferred)).toBe(false);
  });

  it('counts floating panels — a dead dock with one live floater is not dead', () => {
    const doc: LayoutDoc = {
      ...layoutOf('data:git'),
      floating: [
        {
          id: 'f1',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          activePanelId: 'fp1',
          panels: [{ id: 'fp1', type: 'adv:work-items' }],
        },
      ],
    };
    expect(isLayoutEntirelyUnregistered(doc, registered('adv:work-items'), pluginDeferred)).toBe(false);
  });
});
