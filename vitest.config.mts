import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` path alias from tsconfig.json.
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` throws on import outside a React Server Component build.
      // Stubbing it lets the server modules it guards be unit-tested directly.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
