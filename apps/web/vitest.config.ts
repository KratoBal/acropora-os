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
    // Kézzel karbantartott lista, mert nem minden teszt fut vitesttel: a
    // `src/lib/products/list-state.test.ts` a node:test API-ját használja, és
    // a package.json futtatja külön. Ami lemarad innen, az NEM hibázik, csak
    // csendben nem fut - ezért méri a `src/test/test-inventory.component.test.ts`
    // ezt a listát a lemezen lévő fájlokhoz.
    include: [
      "src/**/*.component.test.{ts,tsx}",
      "src/components/brands/brand-import-assistant-page.test.tsx",
      "src/lib/api/**/*.test.ts",
      "src/lib/auth/production-auth.test.ts",
      "src/lib/navigation/**/*.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
});
