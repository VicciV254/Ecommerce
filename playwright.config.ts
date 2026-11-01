import { defineConfig } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT } from "./tests/browser-config";

const previewDirectory = `.cache/e2e-preview-${E2E_PORT}`;

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
    command: `npm run build -- --mode test --outDir ${previewDirectory} && npm run preview -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort --outDir ${previewDirectory}`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { NODE_ENV: "production", VITE_API_URL: `${E2E_ORIGIN}/api` },
  },
});
