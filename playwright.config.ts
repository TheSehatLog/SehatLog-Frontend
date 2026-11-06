import { defineConfig, devices } from "@playwright/test";

// Browser tests of the demo path against the real local stack:
//   npx playwright test            (resets the stack first; SEHATLOG_E2E_RESET=0 to skip)
//   npx playwright test --headed   (watch it click through)
export default defineConfig({
  testDir: "tests/ui",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/ui/global-setup.ts",
  use: {
    baseURL: "http://localhost:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npx next dev -p 3210",
    url: "http://localhost:3210/live",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
