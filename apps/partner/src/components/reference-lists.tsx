"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { worksheetStatusLabel } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { Empty, Message } from "./ticket-list";
import {
  ALLAPOT_CIMKE,
  CIMKE,
  LAP_CIM,
  LAP_FEJLEC,
  LAP_LEIRAS,
  PANEL_CIM,
} from "./frame";

/*
  AZ `Assets` KOMPONENS INNEN 2026-09-24-EN ATKOLTOZOTT AZ `asset-list.tsx`
  SAJAT FAJLBA, es `AssetList` neven -- Balazs kerese, hogy az eszkozkezelo
  UGYANUGY nezzen ki, mint az app.acropora.hu, tobb mint amit ez a keret
  (kartya-lista, nyers allapot-enum) adni tudott. A `Worksheets` valtozatlan
  marad: a munkalap-lapok ebben a korben nem erintettek.
*/

export function Worksheets() {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.worksheets>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void partnerApi
      .worksheets()
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A munkalapok nem tölthetők be.",
        ),
      );
  }, []);
  return (
    <section>
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>SZERVIZMUNKA</p>
          <h1 className={LAP_CIM}>Munkalapok</h1>
          <p className={LAP_LEIRAS}>
            A saját munkalapok itt olvashatók, fényképekkel és aláírással.
          </p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      {data?.items.length ? (
        <div className="card-list">
          {data.items.map((sheet) => (
            <Link
              className="reference-card"
              key={sheet.id}
              href={`/munkalapok/${sheet.id}`}
            >
              <div>
                <p className="ticket-number">{sheet.number ?? "Piszkozat"}</p>
                <h2 className={PANEL_CIM}>{sheet.subject}</h2>
                <p>
                  {sheet.departmentPath?.join(" / ") ?? sheet.departmentCode}
                </p>
              </div>
              <div>
                {/*
                  A FELIRAT A KÖZÖS SZÓTÁRBÓL JÖN, nem a nyers enum-érték. A
                  partner eddig `SIGNED` és `DRAFT` feliratot látott a saját
                  munkalapján: a szótár az `apps/web`-ben lakott, ahonnan ez a
                  csomag nem importálhat. 2026-09-21 óta a `@acropora/types`-ban
                  áll, egy helyen mind a két felületnek.
                */}
                <span className={ALLAPOT_CIMKE}>
                  {worksheetStatusLabel[sheet.status]}
                </span>
                <time dateTime={sheet.updatedAt}>
                  {new Intl.DateTimeFormat("hu-HU", {
                    dateStyle: "medium",
                  }).format(new Date(sheet.updatedAt))}
                </time>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="Nincs megjeleníthető munkalap"
          text="A partneri fiókhoz jelenleg nincs munkalap."
        />
      )}
    </section>
  );
}
