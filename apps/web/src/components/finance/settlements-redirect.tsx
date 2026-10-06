"use client";

import { Alert } from "@acropora/ui";
import { isNavigationEntryVisible } from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { SETTLEMENT_TABS } from "@/components/navigation";

/**
 * AZ ELSZÁMOLÁSOK GYŰJTŐ-ÚTVONALA: az első olyan fülre visz, amihez a
 * felhasználónak joga van. Saját tartalma nincs, csak ha egyik fül sem
 * érhető el.
 */
export function SettlementsRedirect() {
  const { session } = useAuth();
  const router = useRouter();
  const target = SETTLEMENT_TABS.find(
    (tab) => session && isNavigationEntryVisible(tab.entryId, session.user),
  );

  useEffect(() => {
    if (target) router.replace(target.href);
  }, [router, target]);

  if (!session || target) return null;
  return (
    <Alert
      variant="danger"
      title="Nincs hozzáférésed az elszámolásokhoz"
      description="finance.view jogosultság szükséges."
    />
  );
}
