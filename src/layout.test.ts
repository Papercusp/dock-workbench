import { describe, it, expect } from 'vitest';
import {
  validateLayoutDoc,
  isWellFormedLayout,
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
