import { sharedHostWorkerCap } from '@papercusp/test-config/vitest-config';
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
    // See libs/sync/vitest.config.ts — every project in the root topology must
    // agree on maxWorkers or vitest 4 refuses the run.
    ...sharedHostWorkerCap(),
  },
});
