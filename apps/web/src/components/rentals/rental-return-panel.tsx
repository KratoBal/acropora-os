"use client";

import { Alert, Button, Input } from "@acropora/ui";
import {
  formatMoney,
  type Rental,
  type RentalReturnPreview,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { rentalsApi } from "@/lib/api/rentals";
import { budapestLocalToIso } from "@/lib/format/date";

import {
  emptyRentalReturnForm,
  rentalReturnRequest,
  type RentalReturnForm,
} from "./rental-return-form";

const huf = (amount: number) => formatMoney(amount, "HUF");

/**
 * TAKING A DEVICE BACK (task eszkozberles, S4). The settlement shown is the server's (the same rule and the terms the rental
 * agreed when recorded), so the desk confirms what will be stored. A term not set when the contract was signed is said in
 * words, never filled in with a number: no late surcharge without a multiplier, no replacement deadline without its days.
 */
export function RentalReturnPanel({
  rental,
  token,
  now,
  onReturned,
  onCancel,
}: {
  rental: Rental;
  token: string;
  now: () => Date;
  onReturned: (returned: Rental) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RentalReturnForm>(() =>
    emptyRentalReturnForm(now()),
  );
  const [preview, setPreview] = useState<RentalReturnPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const returnedAt = budapestLocalToIso(form.returnedAt);
    if (!returnedAt) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    rentalsApi
      .returnPreview(token, rental.id, returnedAt, controller.signal)
      .then((answer) => {
        setPreview(answer);
        setError(null);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setPreview(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Az elszámolás nem számolható ki.",
        );
      });
    return () => controller.abort();
  }, [token, rental.id, form.returnedAt]);

  const set = (key: keyof RentalReturnForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const recordReturn = async () => {
    const request = rentalReturnRequest(form, rental.depositHuf);
    if (!request.ok) {
      setError(request.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onReturned(
        await rentalsApi.returnRental(token, rental.id, request.input),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A visszavétel nem rögzíthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const s = preview?.settlement;
  const kept = rentalReturnRequest(form, rental.depositHuf);
  const keptHuf = kept.ok ? kept.input.depositKeptHuf : null;

  return (
    <div className="mt-3 w-full space-y-4 rounded-lg border border-dusk-200 bg-dusk-50 p-4">
      <h3 className="font-semibold text-dusk-900">
        Visszavétel: {rental.rentalNumber}
      </h3>
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-dusk-700">
          Visszahozás időpontja
        </span>
        <Input
          aria-label="Visszahozás időpontja"
          type="datetime-local"
          value={form.returnedAt}
          onChange={(event) => set("returnedAt")(event.target.value)}
        />
      </label>

      {s && preview ? (
        <dl className="space-y-1 text-sm" aria-label="Elszámolás">
          <div>
            <dt className="inline font-medium">Bérleti díj: </dt>
            <dd className="inline">
              {s.periods} × {huf(rental.dailyFeeHuf)} = {huf(s.feeHuf)}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Késés: </dt>
            <dd className="inline">
              {s.latePeriods === 0
                ? "nincs"
                : `${s.latePeriods} megkezdett nap (a díjban benne van)`}
            </dd>
          </div>
          {s.latePeriods > 0 ? (
            <div>
              <dt className="inline font-medium">Késedelmi pótdíj: </dt>
              <dd className="inline">
                {s.lateSurchargeHuf === null
                  ? "a bérléskor nem volt késedelmi szorzó megadva, ezért pótdíj nem számolódik"
                  : `${huf(s.lateSurchargeHuf)} (szorzó: ${s.lateFeeMultiplier})`}
              </dd>
            </div>
          ) : null}
          {s.latePeriods > 0 && preview.replacementAfterDays === null ? (
            <p className="text-dusk-600">
              Hány nap késés után jár a pótlási érték: a bérléskor nem volt
              megadva.
            </p>
          ) : null}
          {s.replacementClaimable ? (
            <p className="font-medium text-red-700">
              A késés meghaladja a {preview.replacementAfterDays} napot: a
              pótlási érték ({huf(preview.replacementValueHuf)}) érvényesíthető.
              A rendszer ezt nem számolja fel.
            </p>
          ) : null}
          <div>
            <dt className="inline font-medium">Fizetendő: </dt>
            <dd className="inline">
              {huf(s.feeHuf + (s.lateSurchargeHuf ?? 0))}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-dusk-500">Az elszámolás számolódik…</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-dusk-700">
            Visszatartott kaució (Ft)
          </span>
          <Input
            aria-label="Visszatartott kaució (Ft)"
            inputMode="numeric"
            value={form.depositKeptHuf}
            onChange={(event) => set("depositKeptHuf")(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-dusk-700">
            A visszatartás oka
          </span>
          <Input
            aria-label="A visszatartás oka"
            value={form.depositKeptReason}
            onChange={(event) => set("depositKeptReason")(event.target.value)}
          />
        </label>
      </div>
      <p className="text-sm text-dusk-700">
        Kaució: {huf(rental.depositHuf)}
        {keptHuf === null
          ? ""
          : ` · visszajár: ${huf(Math.max(0, rental.depositHuf - keptHuf))}`}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void recordReturn()}
          disabled={saving || !preview}
        >
          Visszavétel rögzítése
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Mégse
        </Button>
      </div>
    </div>
  );
}
