import { Suspense } from "react";

import { AuthGate } from "@/components/auth/auth-gate";
import { AssetListPrintPage } from "@/components/service-assets/asset-list-print-page";

/**
 * AZ ESZKÖZLISTA NYOMTATÁSA (kártya 323e9b38): a shell-en KÍVÜL, hogy a
 * menü, az oldalsáv és Sutyerák ne kerüljön a papírra. A bejelentkezést
 * ugyanaz a kapu védi, mint a shellt.
 */
export default function AssetListPrintRoute() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <AssetListPrintPage />
      </Suspense>
    </AuthGate>
  );
}
