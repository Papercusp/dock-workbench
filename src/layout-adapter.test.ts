import { describe, it, expect } from 'vitest';
import { toDockviewJson, toLayoutDoc, roundTrip } from './layout-adapter';
import { validateLayoutDoc, type LayoutDoc } from './layout';

const doc: LayoutDoc = {
  schemaVersion: 1,
  root: {
    kind: 'group',
    id: 'root',
    direction: 'row',
    children: [
      {
        kind: 'tabs',
        id: 'left',
        activePanelId: 'p1',
        size: 0.3,
        panels: [
          { id: 'p1', type: 'queue', title: 'Queue', params: { harness: 'x' } },
          { id: 'p2', type: 'markets', title: 'Markets' },
        ],
      },
      {
        kind: 'tabs',
        id: 'right',
        activePanelId: 'p3',
        size: 0.7,
        panels: [{ id: 'p3', type: 'detail', title: 'Detail' }],
      },
    ],
  },
};

describe('toDockviewJson', () => {
  it('maps a row group to a HORIZONTAL grid and collects panels by id', () => {
    const dv = toDockviewJson(doc);
    expect(dv.grid.orientation).toBe('HORIZONTAL');
    expect(Object.keys(dv.panels).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(dv.panels.p1.contentComponent).toBe('queue');
    expect(dv.panels.p1.params).toEqual({ harness: 'x' });
  });

  it('maps a col root to a VERTICAL grid', () => {
    const colDoc: LayoutDoc = { ...doc, root: { ...(doc.root as any), direction: 'col' } };
    expect(toDockviewJson(colDoc).grid.orientation).toBe('VERTICAL');
  });

  it('wraps a root tab strip in the branch required by dockview', () => {
    const tabRootDoc: LayoutDoc = {
      schemaVersion: 1,
      root: {
        kind: 'tabs',
        id: 'manager',
        activePanelId: 'event-manager',
        panels: [
          { id: 'event-manager', type: 'event-manager' },
          { id: 'event-settings', type: 'event-settings' },
        ],
      },
    };

    const dv = toDockviewJson(tabRootDoc);
    expect(dv.grid.root.type).toBe('branch');
    expect(dv.grid.root.data).toHaveLength(1);
    expect(dv.grid.root.data[0]).toMatchObject({
      type: 'leaf',
      data: {
        id: 'manager',
        views: ['event-manager', 'event-settings'],
        activeView: 'event-manager',
      },
    });
  });

  it('serializes floating groups with position geometry', () => {
    const withFloat: LayoutDoc = {
      ...doc,
      floating: [
        { id: 'f1', x: 10, y: 20, width: 300, height: 200, activePanelId: 'pf', panels: [{ id: 'pf', type: 'note' }] },
      ],
    };
    const dv = toDockviewJson(withFloat);
    expect(dv.floatingGroups).toHaveLength(1);
    expect(dv.floatingGroups![0].position).toEqual({ left: 10, top: 20, width: 300, height: 200 });
    expect(dv.panels.pf.contentComponent).toBe('note');
  });
});

describe('round-trip (toLayoutDoc ∘ toDockviewJson)', () => {
  it('preserves structure, panel identity, types, titles, params and active tabs', () => {
    const back = roundTrip(doc);
    expect(() => validateLayoutDoc(back)).not.toThrow();

    const root = back.root as Extract<LayoutDoc['root'], { kind: 'group' }>;
    expect(root.kind).toBe('group');
    expect(root.direction).toBe('row');
    expect(root.children).toHaveLength(2);

    const [left, right] = root.children as any[];
    expect(left.kind).toBe('tabs');
    expect(left.id).toBe('left');
    expect(left.activePanelId).toBe('p1');
    expect(left.panels.map((p: any) => p.id)).toEqual(['p1', 'p2']);
    expect(left.panels[0]).toMatchObject({ type: 'queue', title: 'Queue', params: { harness: 'x' } });
    expect(right.panels[0]).toMatchObject({ id: 'p3', type: 'detail' });
  });

  it('marks a dangling panel reference as an orphan instead of dropping it', () => {
    const dv = toDockviewJson(doc);
    delete dv.panels.p2; // simulate a panel id present in a leaf but missing from the panel map
    const back = toLayoutDoc(dv);
    const left = (back.root as any).children[0];
    const orphan = left.panels.find((p: any) => p.id === 'p2');
    expect(orphan.type).toBe('__missing__');
    expect(orphan.params).toEqual({ __orphan: true });
  });
});
