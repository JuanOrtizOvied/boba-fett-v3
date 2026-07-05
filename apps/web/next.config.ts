import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // This is a Yarn workspace monorepo — pin the file-tracing root to the
  // repo root so the standalone build correctly bundles hoisted
  // node_modules instead of guessing based on lockfile location.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
