import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's tsconfig.json sets `jsx: "preserve"` for Next.js's own SWC
  // transform, and Vite's default oxc transformer picks that up too. Force
  // the standard automatic JSX runtime here — otherwise oxc refuses to
  // transform JSX in test files ("Unexpected JSX expression").
  oxc: {
    jsx: "automatic",
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
