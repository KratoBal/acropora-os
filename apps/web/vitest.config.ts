import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  test: {
    environment: "happy-dom",
    include: [
      "src/**/*.component.test.{ts,tsx}",
      "src/components/brands/brand-import-assistant-page.test.tsx",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
});
