import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's tsconfig.json sets `jsx: "preserve"` for Next.js's own SWC
  // transform. Force the standard automatic JSX runtime for tests; otherwise
  // the test transformer refuses to
  // transform JSX in test files ("Unexpected JSX expression").
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
