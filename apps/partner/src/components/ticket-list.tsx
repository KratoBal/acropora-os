"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ServiceListFooter,
  ServiceListHeader,
  ServiceListTabs,
  ServiceStatusBadge,
  sv,
  type ServiceListTab,
} from "@acropora/ui";
import { partnerStatusTone } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { ticketScopeTotal } from "@/lib/ticket-scope-counts";
import { PANEL_CIM } from "./frame";

/**
 * A HIBAJEGY-LISTA A `service-job-list-page.tsx` MINTÁJA SZERINT.
 *
 * Balázs kérése (2026-09-21, megerősítve 2026-09-24 07:28 UTC): a
 * partnerportál lapjai nézzenek ki pontosan úgy, mint az app.acropora.hu
 * megfelelőik. Ez a fájl a `ServiceListHeader`/`ServiceListTabs`/
 * `ServiceStatusBadge`/`ServiceListFooter` közös kereteket veszi át
 * `@acropora/ui`-ból -- ugyanazokat, amiket a belső lista használ --, a
 * korábbi kézzel írt kártya-rács helyett egy táblázatot rajzol.
 *
 * A `Message` ÉS AZ `Empty` KOMPONENS EBBŐL A FÁJLBÓL, VÁLTOZATLANUL MARAD.
 * Hat másik fájl importálja a `Message`-t (köztük `asset-detail.tsx`,
 * nautilus párhuzamos munkája), kettő az `Empty`-t -- egyiket sem szabad
 * átnevezni vagy máshova költöztetni. Ez a szerkesztés KIZÁRÓLAG a
 * `TicketList` függvény belsejét cseréli.
 *
 * MA (2026-09-24) A PORTÁLBÓL HIÁNYZIK A TELJES `@theme` BLOKK -- nautilus
 * párhuzamos munkája költözteti át a közös tokeneket. Addig a `brand-*`/
 * `ink`/`paper`/`line` osztályok stílus nélkül látszanak. Ez NEM ennek a
 * fájlnak a hibája, és szándékosan nincs saját, helyi színnel megkerülve:
 * ha az ő PR-je beolvad, ez a lap magától a helyes kinézetet kapja.
 *
 * KIHAGYVA EBBEN A KÖRBEN: a belső lista három statisztika-csempéje
 * (`ServiceListStats`). Az egyetlen elérhető darabszám-mező
 * (`ServiceJobListResponse.counts`) a BELSŐ, nyolc állapotos modell szerint
 * bomlik, a partner viszont a négyértékű `partnerStatus`-t látja -- egy
 * csempe-készlet ehhez vagy szerver-változást igényelne (amihez ehhez a
 * körhöz nem nyúlunk: "Szerverhez nem kell nyulni"), vagy egy kitalált
 * kliens-oldali leképezést, amit a csapat "ne talalgass" elve kizár. A
 * lábléc találatszáma NEM ilyen: az pontosan a szerver saját `scope`-szűrőjét
 * (`serviceJobScopeWhere`) tükrözi, lásd `ticket-scope-counts.ts`.
 */

const SCOPE_TABS: (ServiceListTab & { key: "open" | "closed" | "all" })[] = [
  { key: "open", label: "Nyitott ügyek" },
  { key: "closed", label: "Lezárt ügyek" },
  { key: "all", label: "Összes ügy" },
];

export function TicketList() {
  const [scope, setScope] = useState<"open" | "closed" | "all">("open");
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
      <ServiceListHeader
        eyebrow="PARTNERI SZERVIZ"
        title="Hibajegyek"
        lead="Tekintse át a saját cége hibajegyeit és azok aktuális állapotát."
        action={
          <Link className="primary-link" href="/hibajegyek/uj">
            Új hibajegy nyitása
          </Link>
        }
      />

      {error ? <Message tone="error" text={error} retry={load} /> : null}

      <div className={sv.panel}>
        <ServiceListTabs
          tabs={SCOPE_TABS}
          active={scope}
          onSelect={(key) => setScope(key as typeof scope)}
          label="Hibajegy állapotszűrő"
        />

        {!data && !error ? (
          <p className="px-5 py-[18px] text-xs text-muted">
            Hibajegyek betöltése…
          </p>
        ) : null}

        {data?.items.length === 0 ? (
          <div className="px-5 py-[18px]">
            <Empty
              title="Nincs megjeleníthető hibajegy"
              text="Ebben az állapotszűrőben jelenleg nincs saját hibajegye."
            />
          </div>
        ) : null}

        {data?.items.length ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className={sv.tableHead}>Hibajegy</th>
                <th className={sv.tableHead}>Helyszín</th>
                <th className={sv.tableHead}>Állapot</th>
                <th className={sv.tableHead}>Létrehozva</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((ticket) => (
                <tr key={ticket.id} className={sv.tableRow}>
                  <td className={sv.tableCell}>
                    <Link
                      className={sv.rowTitle}
                      href={`/hibajegyek/${ticket.id}`}
                    >
                      {ticket.title}
                    </Link>
                    <p className={sv.rowMeta}>{ticket.jobNumber}</p>
                  </td>
                  <td className={sv.tableCell}>
                    <span className={sv.rowMeta}>
                      {ticket.departmentPath?.join(" / ") ??
                        "Helyszín nincs megadva"}
                    </span>
                  </td>
                  <td className={sv.tableCell}>
                    <ServiceStatusBadge
                      tone={partnerStatusTone(ticket.partnerStatus)}
                    >
                      {ticket.partnerStatusLabel}
                    </ServiceStatusBadge>
                  </td>
                  <td className={sv.tableCell}>
                    <time dateTime={ticket.createdAt} className={sv.rowMeta}>
                      {new Intl.DateTimeFormat("hu-HU", {
                        dateStyle: "medium",
                      }).format(new Date(ticket.createdAt))}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {data ? (
          <ServiceListFooter
            shown={data.items.length}
            totalItems={ticketScopeTotal(data.counts, scope)}
            tail={{ kind: "capped", truncated: data.truncated }}
          />
        ) : null}
      </div>
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
      <h2 className={PANEL_CIM}>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
