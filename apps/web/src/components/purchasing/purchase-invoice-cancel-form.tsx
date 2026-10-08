"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Textarea,
} from "@acropora/ui";
import type { PurchaseInvoiceDetail } from "@acropora/types";
import { useState } from "react";

import { purchasingApi } from "@/lib/api/purchasing";

/**
 * A RÖGZÍTETT SZÁMLA SZTORNÓJA (Balázs „A 1”, acrobot 28092). A szerver
 * mondja meg, ha nem lehet (kifizetett számla, felhasznált projektfoglalás,
 * már elfogyott készlet); itt csak az ok kell, és hogy mi fog történni.
 */
export function PurchaseInvoiceCancelForm({
  token,
  detail,
  onCancelled,
  onClose,
}: {
  token: string;
  detail: PurchaseInvoiceDetail;
  onCancelled: (detail: PurchaseInvoiceDetail) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onCancelled(
        await purchasingApi.cancel(token, detail.id, { reason: reason.trim() }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A számla nem sztornózható.",
      );
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-dusk-900">
          A rögzítés sztornója
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-dusk-600">
          A számlával érkezett készlet kimegy a raktárból, a projektfoglalásai
          felszabadulnak, és ha NAV-sorból vagy várható beérkezésből jött, azok
          újra rögzíthetők. A számla sztornózottként megmarad, a száma újra
          felhasználható.
        </p>
        {error ? (
          <Alert
            variant="danger"
            title="Nem sztornózható"
            description={error}
          />
        ) : null}
        <label className="block text-sm text-dusk-700">
          A sztornó oka
          <Textarea
            aria-label="A sztornó oka"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Mégse
          </Button>
          <Button
            variant="danger"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            Sztornózás
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
