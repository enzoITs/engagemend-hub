import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      include: ['src/classifier/**', 'src/collector/normalize.ts'],
    },
  },
});
