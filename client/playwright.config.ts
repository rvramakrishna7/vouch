import { defineConfig, devices } from "@playwright/test";

const isLive =
  process.argv.some((arg) => arg.includes("live")) ||
  Boolean(process.env.PLAYWRIGHT_LIVE);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "off",
    actionTimeout: 15000,
  },
  webServer: isLive
    ? undefined
    : {
        command: "npm run build && npx vite preview --port 4173",
        env: {
          VITE_API_URL: "http://api.test",
        },
        port: 4173,
        reuseExistingServer: false,
        timeout: 120000,
      },
  projects: [
    {
      name: "chromium",
      testIgnore: /live-acceptance\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live",
      testMatch: /live-acceptance\.spec\.ts/,
      timeout: 180000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "https://vouch-app-beta.vercel.app",
      },
    },
  ],
});
