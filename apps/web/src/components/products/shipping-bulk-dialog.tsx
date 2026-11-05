"use client";

import { Alert } from "@acropora/ui";
import { useEffect, useState } from "react";

import {
  PilotButton,
  PilotDialog,
  PilotSelect,
} from "@/components/pilot/pilot-ui";
import { JELZOK } from "@/components/products/product-shipping-profile-card";
import type { ProductShippingProfileInput } from "@/lib/api/products";

type FlagKey = (typeof JELZOK)[number]["key"];
type Choice = "" | "yes" | "no";

/**
 * A KIJELÖLT TERMÉKEK SZÁLLÍTÁSI JELZŐI EGY MOZDULATTAL (a82ed229, 2c). Jelzőnként három állás: „nem változik”,
 * „igen”, „nem”. Csak az íródik, amit valaki átállított: egy termék többi jelzője marad, ahogy áll, és ami átíródik,
 * az kézi lesz (a szinkron onnantól nem írja felül), ugyanúgy, mint a kártyán.
 */
export function ShippingBulkDialog({
  open,
  count,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (changes: Partial<ProductShippingProfileInput>) => void;
}) {
  const [choices, setChoices] = useState<Partial<Record<FlagKey, Choice>>>({});
  useEffect(() => {
    if (open) setChoices({});
  }, [open]);
  const changes = Object.fromEntries(
    Object.entries(choices)
      .filter(([, choice]) => choice)
      .map(([key, choice]) => [key, choice === "yes"]),
  ) as Partial<ProductShippingProfileInput>;
  const changed = Object.keys(changes).length;

  return (
    <PilotDialog open={open} onClose={busy ? () => undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipping-bulk-title"
        className="space-y-4 p-6"
      >
        <div>
          <h2
            id="shipping-bulk-title"
            className="text-base font-semibold text-pilot-grey-900"
          >
            Szállítási jelzők: {count} termék
          </h2>
          <p className="mt-1 text-xs text-pilot-grey-600">
            Csak az átállított jelző íródik, és az kézi lesz: a UNAS-szinkron
            onnantól nem írja felül.
          </p>
        </div>
        <div className="space-y-2">
          {JELZOK.map((jelzo) => (
            <label
              key={jelzo.key}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>{jelzo.label}</span>
              <PilotSelect
                chevron
                aria-label={jelzo.label}
                value={choices[jelzo.key] ?? ""}
                onChange={(value) =>
                  setChoices((current) => ({
                    ...current,
                    [jelzo.key]: value as Choice,
                  }))
                }
                className="w-36 shrink-0 [&_select]:h-9"
              >
                <option value="">Nem változik</option>
                <option value="yes">Igen</option>
                <option value="no">Nem</option>
              </PilotSelect>
            </label>
          ))}
        </div>
        {error ? (
          <Alert
            variant="danger"
            title="A mentés nem sikerült"
            description={error}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton
            disabled={busy || changed === 0}
            onClick={() => onSubmit(changes)}
          >
            {busy ? "Mentés…" : `Mentés (${count} termék)`}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}
