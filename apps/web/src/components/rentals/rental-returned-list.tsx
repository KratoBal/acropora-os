"use client";

import { Button, Card, CardContent, CardHeader, Input } from "@acropora/ui";
import { formatMoney, type Rental } from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { rentalsApi } from "@/lib/api/rentals";
import { formatDateTimeHu } from "@/lib/format/date";

const huf = (amount: number) => formatMoney(amount, "HUF");

/** What the search box matches: the contract number, the device (name, serial) and the renter (name, phone, e-mail). */
export function rentalMatches(rental: Rental, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("hu");
  if (needle === "") return true;
  return [
    rental.rentalNumber,
    rental.equipment.name,
    rental.equipment.serialNumber,
    rental.customer.displayName,
    rental.customer.phone,
    rental.customer.email,
  ].some((value) => value?.toLocaleLowerCase("hu").includes(needle));
}

/** The settlement in one line; a rental taken back before the settlement was recorded (S4) says so instead of guessing. */
export function settlementLine(rental: Rental): string {
  const s = rental.settlement;
  if (!s)
    return "Elszámolás nincs rögzítve (a visszavétel az elszámolás bevezetése előtt történt).";
  const fee =
    s.lateSurchargeHuf && s.lateSurchargeHuf > 0
      ? `Díj: ${huf(s.feeHuf + s.lateSurchargeHuf)} (ebből késedelmi pótdíj ${huf(s.lateSurchargeHuf)})`
      : `Díj: ${huf(s.feeHuf)}`;
  const deposit =
    s.depositKeptHuf > 0
      ? `kaucióból visszatartva ${huf(s.depositKeptHuf)}${s.depositKeptReason ? ` (${s.depositKeptReason})` : ""}, visszajárt ${huf(Math.max(0, rental.depositHuf - s.depositKeptHuf))}`
      : `kaució teljes egészében visszajárt (${huf(rental.depositHuf)})`;
  return `${fee} · ${deposit}`;
}

/**
 * THE RENTALS ALREADY TAKEN BACK (Balázs, 2026-11-10 14:16 UTC, msg 1569717440554860576: "a már visszahozott eszközök bérlése is
 * látszódjon valahol"). The same list route as the devices out, with `status=RETURNED` (newest first, the settlement on each row);
 * the contract can be printed again from here. `reloadKey` changes after a return, so the new row shows at once.
 */
export function RentalReturnedList({
  token,
  reloadKey,
  onPrint,
}: {
  token: string;
  reloadKey: number;
  onPrint: (rental: Rental) => void;
}) {
  const [rows, setRows] = useState<Rental[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    rentalsApi
      .list(token, "RETURNED", controller.signal)
      .then((answer) => {
        setRows(answer.items);
        setTruncated(answer.truncated);
        setError(null);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A visszahozott bérlések nem tölthetők be.",
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token, reloadKey]);

  /*
    A CUT LIST IS SEARCHED IN THE DATABASE (#2370 open point): over RENTAL_LIST_LIMIT rows the loaded ones are only the
    newest, and filtering them would miss an older rental. Then the search goes to the server (the same fields, 300 ms
    after the last key); an uncut list keeps filtering in the browser, at once. `searched` holds the answer for one query.
  */
  const [searched, setSearched] = useState<{
    q: string;
    items: Rental[];
    truncated: boolean;
  } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!truncated || q === "") {
      setSearched(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      rentalsApi
        .list(token, "RETURNED", controller.signal, q)
        .then((answer) =>
          setSearched({ q, items: answer.items, truncated: answer.truncated }),
        )
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof Error ? cause.message : "A keresés nem futott le.",
          );
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, reloadKey, truncated, query]);

  const active = searched?.q === query.trim() ? searched : null;
  const shown = useMemo(() => {
    const source = active ? active.items : rows;
    return source.filter((r) => rentalMatches(r, query));
  }, [rows, active, query]);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-dusk-900">
          Visszahozott eszközök
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-dusk-700">Keresés</span>
          <Input
            aria-label="Keresés a visszahozott bérlések között"
            placeholder="Szerződésszám, eszköz vagy bérlő"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : loading ? (
          <p className="text-sm text-dusk-500">Betöltés…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-dusk-500">
            Még nincs visszahozott eszköz.
          </p>
        ) : (
          <>
            {/* the server's answer to a search can be cut too (barracuda, #2395): then that is the sentence */}
            {active ? (
              active.truncated ? (
                <p className="text-sm font-medium text-amber-700">
                  A keresés találatai nem teljesek: csak a legutóbbi{" "}
                  {active.items.length} látszik. Szűkítsd a keresést.
                </p>
              ) : null
            ) : truncated ? (
              <p className="text-sm font-medium text-amber-700">
                A lista nem teljes: csak a legutóbbi {rows.length} visszahozott
                bérlés látszik.
              </p>
            ) : null}
            {shown.length === 0 ? (
              <p className="text-sm text-dusk-500">
                Nincs a keresésnek megfelelő bérlés.
              </p>
            ) : (
              <ul className="divide-y" aria-label="Visszahozott bérlések">
                {shown.map((rental) => (
                  <li
                    key={rental.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-dusk-900">
                        {rental.rentalNumber} · {rental.equipment.name}
                        {rental.equipment.serialNumber
                          ? ` (${rental.equipment.serialNumber})`
                          : ""}
                      </p>
                      <p className="text-dusk-700">
                        {rental.customer.displayName}
                        {rental.customer.phone
                          ? ` · ${rental.customer.phone}`
                          : ""}
                      </p>
                      <p className="text-dusk-500">
                        Kint: {formatDateTimeHu(rental.startsAt)} · visszahozva:{" "}
                        {rental.returnedAt
                          ? formatDateTimeHu(rental.returnedAt)
                          : "nincs rögzítve"}
                      </p>
                      <p className="text-dusk-700">{settlementLine(rental)}</p>
                    </div>
                    <Button variant="secondary" onClick={() => onPrint(rental)}>
                      Szerződés
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
