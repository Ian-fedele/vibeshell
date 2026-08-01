import { defineConfig } from "vitest/config";

// The engine package's tests live in src/. The desktop app has its own
// vitest (run from desktop/), so keep the root runner scoped to src/.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
