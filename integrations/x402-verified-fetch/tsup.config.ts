import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Keep the x402 stack external so the agent host resolves its own copies.
  external: ["@x402/core", "@x402/fetch", "@x402/evm", "viem"],
});
