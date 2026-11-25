"use client";

import { ConfirmDialog, PilotButton } from "@acropora/ui";
import { useState, type ComponentProps } from "react";

import { maintenanceInvoiceApi } from "@/lib/api/maintenance-invoice";

/**
 * A TIG-SZÁMLA PISZKOZAT TÖRLÉSE (Luca kérése, acrobot 61225; KT-2026-009): a kiadott piszkozat előnézete a törlés után újra
 * elkészíthető ("Piszkozat készítése"), a TIG mostani leképezésével. A tétel az igazolásból jön és nem szerkeszthető (Luca
 * döntése: a számla mennyiségei és összegei MINDIG egyeznek a TIG-gel), ezért a hibás előnézetre ez az egyetlen kiút. A megerősítés
 * kimondja, mi törlődik és mi nem. A szerver elutasítása (kiállítás indult, közben megváltozott) a hívó hibasorában jelenik meg.
 * Egy komponens a két panelnek (szerviz munka és megrendelés), hogy a szöveg és a viselkedés ne csússzon szét.
 */
export function MaintenanceInvoiceDraftDelete({
  token,
  invoiceId,
  size,
  onDeleted,
  onError,
}: {
  token: string;
  invoiceId: string;
  size?: ComponentProps<typeof PilotButton>["size"];
  /** A törlés sikerült: a hívó újra olvassa a panel állapotát (nincs piszkozat). */
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const deleteNow = async () => {
    setBusy(true);
    try {
      await maintenanceInvoiceApi.deleteDraft(token, invoiceId);
      setOpen(false);
      onDeleted();
    } catch (cause) {
      setOpen(false);
      onError(
        cause instanceof Error ? cause.message : "A piszkozat nem törölhető.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PilotButton
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        Piszkozat törlése
      </PilotButton>
      <ConfirmDialog
        open={open}
        title="Biztos, hogy törlöd a piszkozat-számlát?"
        consequence="A piszkozat és az előnézete törlődik. A teljesítési igazolás és a tételei nem változnak, a számla tartalma mindig az igazolásból jön."
        recovery="Utána a Piszkozat készítése gombbal újra elkészíthető, friss előnézettel. Kiállított számla nem törölhető."
        confirmLabel="Törlöm"
        busy={busy}
        onConfirm={() => void deleteNow()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
