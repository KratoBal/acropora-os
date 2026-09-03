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
      // A KOMPONENS-MAPPA MINDEN TESZTJE, NEM FAJLONKENT FELSOROLVA. Eddig egy
      // fajlnev allt itt kezzel; egy masodik ugyanolyan fajta teszt (tiszta
      // fuggveny a kepernyo szotarabol) nem illeszkedett volna ra, es CSENDBEN
      // nem futott volna le. A leltar-halo ezt megfogta -- de a javitas nem egy
      // ujabb kezzel irt sor, mert az pontosan a KOVETKEZO uj esetet hagyna ki.
      "src/components/**/*.test.{ts,tsx}",
      "src/lib/api/**/*.test.ts",
      "src/lib/auth/production-auth.test.ts",
      "src/lib/proxy-timeout.test.ts",
      "src/lib/navigation/**/*.test.ts",
      "src/lib/partners/**/*.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
});
