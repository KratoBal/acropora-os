"use client";

import { Alert, Badge, Button, ConfirmDialog, Input } from "@acropora/ui";
import type { ProductBarcodeSummary } from "@acropora/types";
import { useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * Barcode editor for one variant, rendered inside the variant card beside the
 * extension editor and taking its `token`/`canManage` props the same way.
 *
 * The input is deliberately a plain text field submitted by a form: a handheld
 * scanner types the digits and sends Enter, so submit-on-Enter *is* the
 * scanner support. Nothing device-specific is needed for the shop floor.
 */
export function BarcodeEditor({
  barcodes,
  canManage,
  onChanged,
  token,
  variantId,
}: {
  barcodes: ProductBarcodeSummary[];
  canManage: boolean;
  onChanged: (items: ProductBarcodeSummary[]) => void;
  token: string;
  variantId: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * MELYIK VONALKODOT TOROLNENK. A gomb eddig AZONNAL torolt: egy elgepelt
   * koppintas veglegesen elvitt egy vonalkodot, es a felhasznalo csak akkor
   * vette eszre, amikor a beolvasas mar nem talalt semmit. A vonalkod nem
   * allithato vissza, csak ujra felvinni lehet -- ha valaki tudja meg, mi volt.
   */
  const [pendingDelete, setPendingDelete] =
    useState<ProductBarcodeSummary | null>(null);

  const removePending = async () => {
    if (!pendingDelete) return;
    const barcode = pendingDelete;
    setPendingDelete(null);
    await run(async () => {
      const result = await productApi.removeBarcode(
        token,
        variantId,
        barcode.id,
      );
      return result.items;
    });
  };

  const run = async (action: () => Promise<ProductBarcodeSummary[]>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-800">Vonalkódok</h4>
        {barcodes.length === 0 ? (
          <span className="text-xs text-slate-400">Nincs rögzítve</span>
        ) : null}
      </div>

      {error ? (
        <Alert
          variant="danger"
          title="Hiba"
          description={error}
          className="mt-2"
        />
      ) : null}

      {barcodes.length ? (
        <ul className="mt-2 space-y-1.5">
          {barcodes.map((barcode) => (
            <li
              key={barcode.id}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="font-mono text-slate-700">{barcode.code}</span>
              {barcode.isPrimary ? (
                <Badge variant="info">Elsődleges</Badge>
              ) : canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await productApi.setPrimaryBarcode(
                        token,
                        variantId,
                        barcode.id,
                      );
                      return result.items;
                    })
                  }
                >
                  Legyen elsődleges
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className="ml-auto text-rose-600"
                  onClick={() => setPendingDelete(barcode)}
                >
                  Törlés
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!code.trim()) return;
            void run(async () => {
              const created = await productApi.addBarcode(token, variantId, {
                code,
              });
              setCode("");
              return [...barcodes, created];
            });
          }}
        >
          <Input
            aria-label="Új vonalkód"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Olvasd be vagy írd be a vonalkódot"
            disabled={busy}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || !code.trim()}
          >
            Hozzáadás
          </Button>
        </form>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `Törlöd ezt a vonalkódot: ${pendingDelete.code}?`
            : "Törlöd ezt a vonalkódot?"
        }
        consequence={
          pendingDelete?.isPrimary
            ? "Ez az ELSŐDLEGES vonalkód: a törlés után a beolvasása nem találja meg ezt a változatot, és a nyomtatott címkéken lévő kód sem fog működni."
            : "A törlés után a beolvasása nem találja meg ezt a változatot."
        }
        recovery="Nem vonható vissza. Újra felvinni csak akkor lehet, ha a kód megvan valahol -- a terméken vagy egy korábbi címkén."
        confirmLabel="Végleges törlés"
        busy={busy}
        onConfirm={() => void removePending()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
