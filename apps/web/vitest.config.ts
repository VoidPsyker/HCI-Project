import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const resolveLocal = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@meridian/taxonomy": resolveLocal("../../packages/taxonomy/src/index.ts"),
      "@meridian/scoring": resolveLocal("../../packages/scoring/src/index.ts")
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true
  }
});
