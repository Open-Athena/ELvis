import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI swiftshader Chromium launches are slow and occasionally time out at
  // browser-context setup ("Test timeout of 30000ms exceeded while setting up
  // context"). Retry once on CI to absorb infrastructure flakes without
  // masking real failures.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3150',
    trace: 'on-first-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm build && vite preview --port 3150 --strictPort',
    port: 3150,
    reuseExistingServer: !process.env.CI,
  },
})
