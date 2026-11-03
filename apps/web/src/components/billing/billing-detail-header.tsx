"use client";

import { PAGE_HEADER_CLASSES, PilotButton } from "@acropora/ui";
import { useId, useState, type ReactNode } from "react";

/**
 * A SZÁMLA-ADATLAPOK KÖZÖS FEJLÉCE (Balázs, 2026-11-03 08:42 UTC élő képernyőkép, és acrobot 40796 a stage-képek után):
 * a kimenő, a külső és a bejövő számla adatlapja ugyanígy áll.
 *
 * - Bal oldalon a felirat, a szám és az alcím; jobb oldalon felül az állapot-pirulák, alatta a gombsor.
 * - A gombsor EGY tördelődő sor: széles képernyőn (xl, 1280 px felett) a cím mellett, jobbra igazítva; alatta a cím
 *   alatt, balra, a teljes szélességet kapva (1100 px-en a cím melletti hely két gombnyi volt); telefonon két oszlop,
 *   teljes szélességű gombokkal.
 * - A ritkábban kellő műveletek (`more`) a „Továbbiak” gomb mögött, egy második sorban nyílnak le, hogy a fő sor ne
 *   tördeljen le egyetlen árva gombot (a stage 1440 px-es képén a hatodik gomb egyedül csúszott a következő sorba).
 * - A hívók a gombokat `size="regular"`-ral adják: egy sorban mind egyforma magas (a Sztornó eddig magasabb volt).
 * - A felirat, a cím és az alcím a közös `PageHeader` osztályait viseli (UI 2. csomag), csak az elrendezés saját.
 * - A gombsor a csoport (`actionsLabel`), mert valódi doboza van; a csukott „Továbbiak” sor `hidden`-nel a DOM-ban
 *   marad, hogy az `aria-controls` élő azonosítóra mutasson (barracuda, #2020).
 */
export function BillingDetailHeader({
  eyebrow,
  title,
  subtitle,
  status,
  actions,
  more,
  actionsLabel = "Bizonylat műveletei",
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Az állapot-pirulák (kiállítva, kifizetés, papíron megvan, sztornózott). */
  status?: ReactNode;
  /** A fő gombsor. */
  actions?: ReactNode;
  /** A ritkább műveletek; ha üres, nincs „Továbbiak” gomb. */
  more?: ReactNode;
  /** A fő gombsor csoportjának neve a kisegítő technológiáknak. */
  actionsLabel?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  // a gombsor: telefonon két oszlop, teljes szélességű gombokkal; sm felett egy tördelődő sor, xl-től jobbra igazítva
  const row =
    "grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap xl:justify-end [&_button]:w-full sm:[&_button]:w-auto";
  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0">
        <p className={PAGE_HEADER_CLASSES.eyebrow}>{eyebrow}</p>
        <h1 className={PAGE_HEADER_CLASSES.title}>{title}</h1>
        {subtitle ? (
          <p className={PAGE_HEADER_CLASSES.description}>{subtitle}</p>
        ) : null}
      </div>
      <div className="flex w-full flex-col items-start gap-3 xl:w-auto xl:items-end">
        {status ? (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {status}
          </div>
        ) : null}
        {actions || more ? (
          <div role="group" aria-label={actionsLabel} className={row}>
            {actions}
            {more ? (
              <PilotButton
                size="regular"
                variant="secondary"
                aria-expanded={moreOpen}
                aria-controls={moreId}
                onClick={() => setMoreOpen((open) => !open)}
              >
                Továbbiak
              </PilotButton>
            ) : null}
          </div>
        ) : null}
        {more ? (
          <div
            id={moreId}
            role="group"
            aria-label="További műveletek"
            hidden={!moreOpen}
            className={row}
          >
            {more}
          </div>
        ) : null}
      </div>
    </header>
  );
}
