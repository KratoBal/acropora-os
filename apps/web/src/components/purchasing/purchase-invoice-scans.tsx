"use client";

import { Alert, Button, Card, CardContent, CardHeader } from "@acropora/ui";
import type { PurchaseInvoiceScan } from "@acropora/types";
import { useState } from "react";

import { purchasingApi } from "@/lib/api/purchasing";

const DAY = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  dateStyle: "short",
  timeStyle: "short",
});

/**
 * A SZÁMLAKÉP (kártya 5ec62e35, Luca). A beszkennelt számla (PDF, JPEG vagy
 * PNG) a rögzített számlához csatolható, a beolvasótól és a tételektől
 * függetlenül; a kép PDF-ként tárolódik, ugyanott, ahol a többi bejövő számla.
 */
export function PurchaseInvoiceScans({
  token,
  invoiceId,
  scans,
  canManage,
  onChange,
}: {
  token: string;
  invoiceId: string;
  scans: PurchaseInvoiceScan[];
  canManage: boolean;
  onChange: (scans: PurchaseInvoiceScan[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await purchasingApi.attachScan(token, invoiceId, file));
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A számlakép nem csatolható.",
      );
    } finally {
      setBusy(false);
    }
  };

  const open = async (scan: PurchaseInvoiceScan) => {
    setError(null);
    try {
      const blob = await purchasingApi.scanPdf(token, invoiceId, scan.id);
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A számlakép nem nyitható meg.",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-dusk-900">Számlakép</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        {scans.length ? (
          <ul className="space-y-1 text-sm">
            {scans.map((scan) => (
              <li key={scan.id} className="flex flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  aria-label={`${scan.fileName} megnyitása`}
                  onClick={() => void open(scan)}
                >
                  {scan.fileName}
                </Button>
                <span className="text-xs text-dusk-500">
                  {DAY.format(new Date(scan.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-dusk-500">Nincs csatolt számlakép.</p>
        )}
        {canManage ? (
          <label className="block text-sm">
            <span className="font-medium">
              {busy ? "Csatolás…" : "Számlakép csatolása (PDF, JPEG vagy PNG)"}
            </span>
            <input
              type="file"
              aria-label="Számlakép csatolása"
              accept="application/pdf,image/jpeg,image/png"
              disabled={busy}
              className="mt-1 block text-sm"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        ) : null}
      </CardContent>
    </Card>
  );
}
