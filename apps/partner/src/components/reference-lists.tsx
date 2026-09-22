"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  worksheetStatusLabel,
  type WorksheetDepartmentSummary,
} from "@acropora/types";

import { eszkozAzonosito } from "@/lib/eszkoz-azonosito";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Empty, Message } from "./ticket-list";
import {
  ALLAPOT_CIMKE,
  CIMKE,
  LAP_CIM,
  LAP_FEJLEC,
  LAP_LEIRAS,
  PANEL,
  PANEL_CIM,
} from "./frame";

function locationRows(items: WorksheetDepartmentSummary[]) {
  const children = new Map<string | null, WorksheetDepartmentSummary[]>();
  for (const item of items) {
    const rows = children.get(item.parentId) ?? [];
    rows.push(item);
    children.set(item.parentId, rows);
  }
  const rows: { item: WorksheetDepartmentSummary; depth: number }[] = [];
  const add = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      rows.push({ item, depth });
      add(item.id, depth + 1);
    }
  };
  add(null, 0);
  return rows;
}

export function Locations() {
  const { user } = useAuth();
  const [items, setItems] = useState<WorksheetDepartmentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.customerId) return;
    void partnerApi
      .departments(user.customerId)
      .then((result) => setItems(result.items))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A helyszínek nem tölthetők be.",
        ),
      );
  }, [user?.customerId]);
  const rows = useMemo(() => locationRows(items), [items]);
  return (
    <section>
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>SAJÁT ADATOK</p>
          <h1 className={LAP_CIM}>Helyszínek</h1>
          <p className={LAP_LEIRAS}>
            A cégéhez tartozó helyszínek csak olvasható nézetben.
          </p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      {rows.length ? (
        <div className={PANEL}>
          <ul className="tree-list">
            {rows.map(({ item, depth }) => (
              <li key={item.id} style={{ paddingLeft: `${depth * 1.25}rem` }}>
                <strong>{item.name}</strong>
                <span>
                  {item.code} · {item.isActive ? "Aktív" : "Archivált"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty
          title="Nincs megjeleníthető helyszín"
          text="A partneri fiókhoz jelenleg nincs helyszín rögzítve."
        />
      )}
    </section>
  );
}

export function Assets() {
  const { user } = useAuth();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.assets>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kereses, setKereses] = useState("");
  const [helyszin, setHelyszin] = useState("");
  const [helyszinek, setHelyszinek] = useState<
    { id: string; name: string; code: string }[]
  >([]);

  /*
    A HELYSZINEK UGYANABBOL A FORRASBOL JONNEK, mint a `Helyszinek` lap. Egy
    masodik forras ket kulonbozo listat adna ugyanarra a kerdesre.
  */
  useEffect(() => {
    if (!user?.customerId) return;
    void partnerApi
      .departments(user.customerId)
      .then((valasz) => setHelyszinek(valasz.items))
      .catch(() => setHelyszinek([]));
  }, [user?.customerId]);

  useEffect(() => {
    if (!user?.customerId) return;
    /*
      A SZURES A SZERVEREN TORTENIK. A lista lapozott, tehat a betoltott
      oldal folotti szures a lapozas elso napjan csendben hianyos lenne.
    */
    void partnerApi
      .assets({
        ...(helyszin ? { departmentId: helyszin } : {}),
        ...(kereses.trim() ? { search: kereses } : {}),
      })
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eszközök nem tölthetők be.",
        ),
      );
  }, [user?.customerId, helyszin, kereses]);
  return (
    <section>
      <header className={LAP_FEJLEC}>
        <div>
          <p className={CIMKE}>SAJÁT ADATOK</p>
          <h1 className={LAP_CIM}>Eszközök</h1>
          <p className={LAP_LEIRAS}>
            A cégéhez tartozó eszközök. Kattintson egy eszközre az adatlapjáért.
          </p>
        </div>
      </header>
      {/*
        A KET SZURO EGYUTT MEGY FEL A SZERVERNEK. A helyszin-valasztasnal a
        szerver a RESZFAT is beleveszi, tehat egy nagyobb helyszint valasztva
        az alatta allo egysegek eszkozei is jonnek -- ez szandekos.
      */}
      <div className="filter-bar">
        <label>
          <span>Keresés</span>
          <input
            type="search"
            value={kereses}
            onChange={(esemeny) => setKereses(esemeny.target.value)}
            placeholder="Név, eszközszám, gyártó"
          />
        </label>
        <label>
          <span>Helyszín</span>
          <select
            value={helyszin}
            onChange={(esemeny) => setHelyszin(esemeny.target.value)}
          >
            <option value="">Mind</option>
            {helyszinek.map((egyseg) => (
              <option key={egyseg.id} value={egyseg.id}>
                {egyseg.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <Message tone="error" text={error} /> : null}
      {data?.items.length ? (
        <div className="card-list">
          {data.items.map((asset) => (
            <Link
              className="reference-card"
              key={asset.id}
              href={`/eszkozok/${asset.id}`}
            >
              <div>
                <h2 className={PANEL_CIM}>{asset.name}</h2>
                <p>
                  {eszkozAzonosito(asset)}
                  {asset.inventoryNumber ? ` · ${asset.inventoryNumber}` : ""}
                </p>
              </div>
              <div>
                <span>
                  {asset.unit?.path.join(" / ") ?? "Helyszín nincs megadva"}
                </span>
                <span className={ALLAPOT_CIMKE}>{asset.status}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="Nincs megjeleníthető eszköz"
          text="A partneri fiókhoz jelenleg nincs eszköz rögzítve."
        />
      )}
    </section>
  );
}

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
