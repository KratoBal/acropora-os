"use client";

import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import { useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";

/**
 * A VÁZLAT TÖRLÉSÉNEK GOMBJA ÉS MEGERŐSÍTÉSE (kártya 6a75f15c, Balázs kérdése: "miért nem lehet piszkozatot törölni?"). A szerkesztő
 * csak szerkeszthető vázlaton, törlési joggal kínálja (a `deleteOffered` dönt, a szerver ugyanezt kéri). A szerver hibája (409 az okkal:
 * kiállítás indult, másik bizonylat hivatkozik rá, közben mentették) a gomb alatt marad, amíg újra nem próbálják; a megerősítés
 * kimondja, mi törlődik és hogy nem vonható vissza.
 */
export function deleteOffered(detail: {
  documentId: string | undefined;
  status: string;
  savedUpdatedAt: string | null;
  issued: boolean;
  canManage: boolean;
}): boolean {
  return (
    detail.canManage &&
    Boolean(detail.documentId) &&
    detail.savedUpdatedAt !== null &&
    detail.status === "DRAFT" &&
    !detail.issued
  );
}

export function BillingDraftDelete({
  token,
  id,
  updatedAt,
  onDeleted,
}: {
  token: string;
  id: string;
  /** A legutóbb betöltött vagy mentett állapot időbélyege. */
  updatedAt: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await billingDocumentsApi.deleteDraft(token, id, updatedAt);
      setOpen(false);
      onDeleted();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A vázlat nem törölhető.",
      );
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <PilotButton
          variant="danger"
          size="regular"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          Vázlat törlése
        </PilotButton>
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="A vázlat nem törölhető"
          description={error}
        />
      ) : null}
      <ConfirmDialog
        open={open}
        title="Biztos, hogy törlöd ezt a vázlatot?"
        consequence="A vázlat és a tételei véglegesen törlődnek. Ha egy ajánlat díjbekérője volt, az ajánlat mérföldköve újra felszabadul."
        recovery="A törlés nem vonható vissza: ha mégis kell, újra létre kell hozni."
        confirmLabel="Törlöm"
        busy={busy}
        onConfirm={() => void deleteNow()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
