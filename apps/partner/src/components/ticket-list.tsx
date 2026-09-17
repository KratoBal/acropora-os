"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { partnerApi } from "@/lib/api";

const filters = [
  ["open", "Nyitott ügyek"],
  ["closed", "Lezárt ügyek"],
  ["all", "Összes ügy"],
] as const;

export function TicketList() {
  const [scope, setScope] = useState<(typeof filters)[number][0]>("open");
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.tickets>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await partnerApi.tickets(scope));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A hibajegyek nem tölthetők be.",
      );
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">PARTNERI SZERVIZ</p>
          <h1>Hibajegyek</h1>
          <p>
            Tekintse át a saját cége hibajegyeit és azok aktuális állapotát.
          </p>
        </div>
        <Link className="primary-link" href="/hibajegyek/uj">
          Új hibajegy nyitása
        </Link>
      </header>
      <div className="tabs" role="tablist" aria-label="Hibajegy állapotszűrő">
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={scope === key ? "selected" : ""}
            aria-selected={scope === key}
            onClick={() => setScope(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <Message tone="error" text={error} retry={load} /> : null}
      {!data && !error ? <p className="muted">Hibajegyek betöltése…</p> : null}
      {data?.items.length === 0 ? (
        <Empty
          title="Nincs megjeleníthető hibajegy"
          text="Ebben az állapotszűrőben jelenleg nincs saját hibajegye."
        />
      ) : null}
      {data?.items.length ? (
        <div className="card-list">
          {data.items.map((ticket) => (
            <Link
              key={ticket.id}
              className="ticket-card"
              href={`/hibajegyek/${ticket.id}`}
            >
              <div>
                <p className="ticket-number">{ticket.jobNumber}</p>
                <h2>{ticket.title}</h2>
                <p>
                  {ticket.departmentPath?.join(" / ") ??
                    "Helyszín nincs megadva"}
                </p>
              </div>
              <div className="ticket-meta">
                <span
                  className={`status status-${ticket.partnerStatus.toLowerCase()}`}
                >
                  {ticket.partnerStatusLabel}
                </span>
                <time dateTime={ticket.createdAt}>
                  {new Intl.DateTimeFormat("hu-HU", {
                    dateStyle: "medium",
                  }).format(new Date(ticket.createdAt))}
                </time>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      {data?.truncated ? (
        <p className="notice">
          A legfrissebb hibajegyek láthatók; a lista elérte a megjelenítési
          korlátot.
        </p>
      ) : null}
    </section>
  );
}

export function Message({
  tone,
  text,
  retry,
}: {
  tone: "error" | "info";
  text: string;
  retry?: () => Promise<void>;
}) {
  return (
    <div
      className={`message ${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      <span>{text}</span>
      {retry ? (
        <button type="button" onClick={() => void retry()}>
          Újrapróbálás
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
