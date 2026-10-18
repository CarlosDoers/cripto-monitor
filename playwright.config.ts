import { defineConfig } from '@playwright/test'

// Browser tests for the views that only break on screen (overflow, columns, the phone card layout). They drive the real
// dev server against live OKX data through the app's own proxy, with the password gate off, a scratch tracking ledger
// outside the repo and no alert channel: nothing here can write the deployment's ledger or buzz a phone.
// Uses the Chrome already installed (`channel: 'chrome'`), so there is no browser to download.
const PORT = 5198

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'móvil', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ACCESS_TOKEN: '',
      WATCH_STORAGE: 'file',
      WATCH_LOCAL_DIR: '.watch-e2e',
      NTFY_TOPIC: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
  },
})
