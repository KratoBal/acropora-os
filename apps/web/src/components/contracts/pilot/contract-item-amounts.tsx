"use client";

import { formatMoney } from "@acropora/types";
import type { ContractKind } from "@acropora/types";

import { contractItemAmounts } from "./contract-items";

/**
 * A TÉTEL SZÁMOLT ÖSSZEGE A TÉTEL FEJLÉCSORÁBAN (kártya 51898ed9, Luca 2026-11-19): a nettó (egységár x darab x alkalom) és a
 * bruttó az ÁFA-kulccsal, forintra kerekítve megjelenítve. Csak megjelenítés: a szám a meglévő mezőkből számolódik, a szerveren
 * nincs új mező. Üres, amíg a mezők nem érvényesek (egy félig beírt szám nem ír összeget).
 */
export function ContractItemAmounts({
  item,
  kind,
}: {
  item: Parameters<typeof contractItemAmounts>[0];
  kind: ContractKind;
}) {
  const amounts = contractItemAmounts(item, kind);
  if (!amounts) return null;
  return (
    <span
      data-testid="contract-item-amounts"
      className="mt-1 block text-sm font-medium text-pilot-grey-900"
    >
      Összesen: nettó {formatMoney(amounts.net, "HUF")}, bruttó{" "}
      {formatMoney(amounts.gross, "HUF")}
    </span>
  );
}
