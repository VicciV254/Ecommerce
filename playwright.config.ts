import { defineConfig } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT } from "./tests/browser-config";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort --mode test`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { NODE_ENV: "test", VITE_API_URL: `${E2E_ORIGIN}/api` },
  },
});
