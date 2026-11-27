import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // actionTimeout bounds one click or fill well inside the 30 s test budget, so a stuck step fails
  // as itself instead of exhausting the test and reporting whichever action ran last.
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', actionTimeout: 10_000 },
  webServer: [{
    command: 'mise exec -- pnpm exec tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000
  }, {
    command: 'mise exec -- pnpm exec tsx scripts/e2e-onboarding-server.ts',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 30000
  }]
});
