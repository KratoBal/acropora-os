"use client";

import { Alert } from "@acropora/ui";
import type {
  PartnerDeletionPlan,
  PartnerReferenceSummary,
} from "@acropora/types";
import { useState } from "react";

import { suppliersApi } from "@/lib/api/suppliers";
import { PilotButton, PilotCard } from "@/components/pilot/pilot-ui";

function list(entries: PartnerReferenceSummary[]): string {
  return entries.map((entry) => `${entry.count} ${entry.label}`).join(", ");
}

interface PilotPartnerDeleteButtonProps {
  token: string;
  partnerId: string;
  partnerName: string;
  onDeleted(plan: PartnerDeletionPlan): void;
}

/**
 * Partner törlése, két különböző kérdéssel.
 *
 * A megerősítés csak azután jelenik meg, hogy a szerver megmondta, mi
 * történne: a két ág következménye különböző, tehát a kérdés sem lehet
 * ugyanaz. Egy általános "biztos vagy benne?" mind a kettőre illene, és
 * egyikről sem mondaná meg, mi lesz.
 *
 * A döntést a szerver hozza, itt csak megjelenítjük. A képernyőn látott terv
 * elavulhat, amíg a kérdés kint van - ezért a törlés is a szerver friss
 * döntésével fut le, és annak az eredményét mutatjuk vissza.
 *
 * A TARTALOM ÉS A LOGIKA A RÉGI `partner-delete-button.tsx`-BŐL JÖN
 * VÁLTOZATLANUL (2026-09-25, Figma 13. kör) -- ez már a terv két
 * üzenetét adja szó szerint ("Véglegesen törlöd", "nem törölhető
 * véglegesen"), csak `@acropora/ui` `Card`/`Button` helyett pilot
 * komponensekkel.
 */
export function PilotPartnerDeleteButton({
  token,
  partnerId,
  partnerName,
  onDeleted,
}: PilotPartnerDeleteButtonProps) {
  const [plan, setPlan] = useState<PartnerDeletionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await suppliersApi.deletionPlan(token, partnerId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A törlés következményei nem kérdezhetők le.",
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * A NEVE NEM `confirm`, és ez nem szőrszálhasogatás: a böngészőben a
   * `confirm` egy globális függvény, ami kérdez. Ez viszont már NEM kérdez,
   * hanem TÖRÖL -- egy ugyanolyan nevű helyi függvény pont a legrosszabb helyen
   * mosná össze a kettőt, és a „hol kérdezünk még a böngésző ablakával"
   * keresést is elrontja.
   */
  const runDeletion = async () => {
    setBusy(true);
    setError(null);
    try {
      onDeleted(await suppliersApi.remove(token, partnerId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
      setBusy(false);
    }
  };

  if (!plan)
    return (
      <div className="space-y-3">
        {error ? (
          <Alert
            variant="danger"
            title="A művelet nem sikerült"
            description={error}
          />
        ) : null}
        <PilotButton
          type="button"
          variant="secondary"
          onClick={() => void ask()}
          disabled={busy}
        >
          Partner törlése
        </PilotButton>
      </div>
    );

  const physical = plan.action === "delete";

  return (
    <PilotCard className="space-y-3 border-red-200 bg-red-50/60 p-4">
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      <p className="text-sm font-semibold text-pilot-grey-900">
        {physical
          ? `Véglegesen törlöd: ${partnerName}?`
          : `${partnerName} nem törölhető véglegesen`}
      </p>

      {physical ? (
        <p className="text-sm text-pilot-grey-700">
          {plan.alsoRemoved.length > 0
            ? `Semmilyen bejegyzés nem hivatkozik rá, ezért a sora törlődik. Vele együtt törlődik: ${list(plan.alsoRemoved)}.`
            : "Semmilyen bejegyzés nem hivatkozik rá, ezért a sora törlődik."}{" "}
          Ez nem vonható vissza.
        </p>
      ) : (
        <p className="text-sm text-pilot-grey-700">
          Hivatkozik rá: {list(plan.blockedBy)}. Ezért a partner töröltre lesz
          jelölve: eltűnik a listákból és a választókból, de a régi
          bejegyzéseken továbbra is látszik a neve.
        </p>
      )}

      <div className="flex gap-2">
        <PilotButton
          type="button"
          variant="danger"
          onClick={() => void runDeletion()}
          disabled={busy}
        >
          {physical ? "Végleges törlés" : "Töröltre jelölés"}
        </PilotButton>
        <PilotButton
          type="button"
          variant="secondary"
          onClick={() => setPlan(null)}
          disabled={busy}
        >
          Mégsem
        </PilotButton>
      </div>
    </PilotCard>
  );
}
