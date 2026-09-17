"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { partnerApi } from "@/lib/api";
import { Empty, Message } from "./ticket-list";

export function TicketDetail({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Awaited<
    ReturnType<typeof partnerApi.ticket>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setTicket(await partnerApi.ticket(id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A hibajegy nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <section>
        <Link className="back-link" href="/hibajegyek">
          ← Hibajegyek
        </Link>
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!ticket) return <p className="muted">Hibajegy betöltése…</p>;
  const date = new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return (
    <section>
      <Link className="back-link" href="/hibajegyek">
        ← Hibajegyek
      </Link>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">{ticket.jobNumber}</p>
          <h1>{ticket.title}</h1>
          <p>
            {ticket.departmentPath?.join(" / ") ?? "Helyszín nincs megadva"}
          </p>
        </div>
        <span className={`status status-${ticket.partnerStatus.toLowerCase()}`}>
          {ticket.partnerStatusLabel}
        </span>
      </header>
      <div className="detail-grid">
        <article className="panel">
          <h2>Mi a probléma?</h2>
          <p className="preline">
            {ticket.description ||
              "A hibajegyhez nem rögzítettek részletes leírást."}
          </p>
          <dl>
            <div>
              <dt>Bejelentés ideje</dt>
              <dd>{date.format(new Date(ticket.createdAt))}</dd>
            </div>
            <div>
              <dt>Helyszín</dt>
              <dd>{ticket.departmentPath?.join(" / ") ?? "Nincs megadva"}</dd>
            </div>
          </dl>
        </article>
        <aside className="panel">
          <h2>Érintett eszközök</h2>
          {ticket.assets.length ? (
            <ul className="plain-list">
              {ticket.assets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.assetName}</strong>
                  <span>{asset.assetNumber}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">A hibajegyhez nincs eszköz megjelölve.</p>
          )}
        </aside>
      </div>
      <section className="panel">
        <h2>Mi történt a hibajeggyel?</h2>
        {ticket.timeline.length ? (
          <ol className="timeline">
            {ticket.timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.sortKey}`}>
                <time>{date.format(new Date(entry.at))}</time>
                <span>
                  {entry.kind === "status"
                    ? "A hibajegy állapotát frissítették"
                    : entry.kind === "asset"
                      ? `${entry.asset.assetName} eszköz hozzáadva`
                      : entry.kind === "worksheet"
                        ? "Munkalap kapcsolódik a hibajegyhez"
                        : "Egy csatolmány törölve lett"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty
            title="Még nincs esemény"
            text="A hibajegyhez még nem rögzítettek további eseményt."
          />
        )}
      </section>
    </section>
  );
}
