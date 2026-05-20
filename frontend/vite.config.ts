import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  publicDir: "public",
  resolve: {
    alias: {
      "@data": path.join(repoRoot, "data"),
      "@schema": path.join(repoRoot, "schema"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
