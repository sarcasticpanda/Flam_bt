import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'],
    // Engine geometry and the AI parser are pure functions. They are the cheapest
    // things in this repo to test and the most expensive to debug later.
  },
});
