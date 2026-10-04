import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: that one mounts the API in the dev
// server and loads .env.local, and a test must never see the real credentials.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
