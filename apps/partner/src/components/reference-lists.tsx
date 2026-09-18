"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WorksheetDepartmentSummary } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";
import { Empty, Message } from "./ticket-list";

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
      <header className="page-header">
        <div>
          <p className="eyebrow">SAJÁT ADATOK</p>
          <h1>Helyszínek</h1>
          <p>A cégéhez tartozó helyszínek csak olvasható nézetben.</p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      {rows.length ? (
        <div className="panel">
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
  useEffect(() => {
    if (!user?.customerId) return;
    void partnerApi
      .assets()
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eszközök nem tölthetők be.",
        ),
      );
  }, [user?.customerId]);
  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">SAJÁT ADATOK</p>
          <h1>Eszközök</h1>
          <p>A cégéhez tartozó eszközök csak olvasható nézetben.</p>
        </div>
      </header>
      {error ? <Message tone="error" text={error} /> : null}
      {data?.items.length ? (
        <div className="card-list">
          {data.items.map((asset) => (
            <article className="reference-card" key={asset.id}>
              <div>
                <h2>{asset.name}</h2>
                <p>
                  {asset.assetNumber}
                  {asset.inventoryNumber ? ` · ${asset.inventoryNumber}` : ""}
                </p>
              </div>
              <div>
                <span>
                  {asset.unit?.path.join(" / ") ?? "Helyszín nincs megadva"}
                </span>
                <span className="status neutral">{asset.status}</span>
              </div>
            </article>
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
      <header className="page-header">
        <div>
          <p className="eyebrow">SZERVIZMUNKA</p>
          <h1>Munkalapok</h1>
          <p>A saját munkalapok itt olvashatók, fényképekkel és aláírással.</p>
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
                <h2>{sheet.subject}</h2>
                <p>
                  {sheet.departmentPath?.join(" / ") ?? sheet.departmentCode}
                </p>
              </div>
              <div>
                <span className="status neutral">{sheet.status}</span>
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
