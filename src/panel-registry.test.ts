import { describe, it, expect, vi } from 'vitest';
import { createPanelRegistry } from './panel-registry';

// A panel component is just a React component type; the registry never renders
// it, so a stub function is a sufficient fixture for these unit tests.
const StubPanel = (() => null) as unknown as Parameters<ReturnType<typeof createPanelRegistry>['register']>[1];

describe('PanelRegistry', () => {
  it('registers, gets, and reports has()', () => {
    const r = createPanelRegistry();
    expect(r.has('x')).toBe(false);
    r.register('x', StubPanel, { title: 'X' });
    expect(r.has('x')).toBe(true);
    expect(r.get('x')?.meta.title).toBe('X');
    expect(r.get('missing')).toBeUndefined();
  });

  it('list() returns registered types sorted', () => {
    const r = createPanelRegistry();
    r.register('zeta', StubPanel);
    r.register('alpha', StubPanel);
    r.register('mu', StubPanel);
    expect(r.list()).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('re-registering a type overwrites the entry', () => {
    const r = createPanelRegistry();
    r.register('x', StubPanel, { title: 'first' });
    r.register('x', StubPanel, { title: 'second' });
    expect(r.get('x')?.meta.title).toBe('second');
    expect(r.list()).toEqual(['x']);
  });

  it('unregister removes and reports whether it existed', () => {
    const r = createPanelRegistry();
    r.register('x', StubPanel);
    expect(r.unregister('x')).toBe(true);
    expect(r.has('x')).toBe(false);
    expect(r.unregister('x')).toBe(false);
  });

  it('notifies subscribers on register/unregister and stops after unsubscribe', () => {
    const r = createPanelRegistry();
    const fn = vi.fn();
    const off = r.subscribe(fn);
    r.register('x', StubPanel);
    expect(fn).toHaveBeenCalledTimes(1);
    r.unregister('x');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    r.register('y', StubPanel);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a throwing subscriber does not break notification of others', () => {
    const r = createPanelRegistry();
    const good = vi.fn();
    r.subscribe(() => {
      throw new Error('boom');
    });
    r.subscribe(good);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => r.register('x', StubPanel)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('_reset clears entries and listeners', () => {
    const r = createPanelRegistry();
    const fn = vi.fn();
    r.subscribe(fn);
    r.register('x', StubPanel);
    r._reset();
    expect(r.list()).toEqual([]);
    r.register('y', StubPanel);
    // listener was cleared by _reset, so it should not fire again
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
