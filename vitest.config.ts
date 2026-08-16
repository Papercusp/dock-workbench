import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Per-file `// @vitest-environment jsdom` pragma switches the few suites
    // that need a DOM (localStorage store, React DockWorkspace). Keeping the
    // default `node` makes the pure-logic suites (layout, adapter, registry)
    // fast and dependency-free.
    exclude: ['node_modules', 'dist'],
    testTimeout: 15_000,
  },
});
