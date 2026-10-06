"use client";

import {
  Alert,
  Button,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import type {
  MyServiceWorkItem,
  MyServiceWorkResponse,
  MyServiceWorkView,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceStatusBadge } from "@/components/service/service-list-chrome";
import { tasksApi } from "@/lib/api/tasks";

import {
  SERVICE_WORK_KIND_LABEL,
  serviceWorkHref,
  serviceWorkNextStep,
  serviceWorkOverdueText,
  serviceWorkStatusLabel,
  serviceWorkStatusTone,
} from "./service-work-labels";

/**
 * A FELADATAIM A SZERVIZES SZEMSZÖGÉBŐL (kártya 041a3dd5; Balázs 2026-09-02,
 * „2.”; tervrajz: exchange/picasso-feladataim-2-allapot-*.png).
 *
 * A rád osztott hibajegyek és munkalapok két csoportban: „Rajtad múlik”
 * (most tudsz lépni) és „Máson múlik” (a másik fél lép). A lejárt tétel nem
 * külön szekció, hanem egy piros sor a saját helyén. „Új feladat” gomb itt
 * nincs: a szervizes tételeit a kiosztás adja, nem kézi felvitel.
 */
export function ServiceWorkPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [view, setView] = useState<MyServiceWorkView>("OPEN");
  const [data, setData] = useState<MyServiceWorkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(await tasksApi.serviceWork(token, view, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A feladatlista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token, view],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const shown = data?.view === view ? data : null;
  const empty =
    shown &&
    shown.mine.length === 0 &&
    shown.others.length === 0 &&
    shown.closed.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feladataim"
        description="A rád osztott hibajegyek és munkalapok, aszerint, kin múlik a következő lépés."
      />

      {error ? (
        <Alert
          variant="danger"
          title="Hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={view === "OPEN" ? "primary" : "secondary"}
          onClick={() => setView("OPEN")}
        >
          Nyitott
        </Button>
        <Button
          variant={view === "CLOSED" ? "primary" : "secondary"}
          onClick={() => setView("CLOSED")}
        >
          Lezárt
        </Button>
        {data ? (
          <span className="ml-auto text-sm text-dusk-600">
            {data.openCount} nyitott
          </span>
        ) : null}
      </div>

      {loading && !shown ? (
        <div aria-label="Feladatok betöltése" className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          icon={<Icon name="clipboard" size={20} />}
          title="Nincs megjeleníthető tétel"
          description={
            view === "OPEN"
              ? "Most nincs rád osztott nyitott hibajegy vagy munkalap."
              : "Még nincs lezárt hibajegyed vagy munkalapod."
          }
        />
      ) : null}

      {shown && view === "OPEN" && shown.mine.length > 0 ? (
        <WorkGroup
          testId="group-mine"
          title={`Rajtad múlik · ${shown.mine.length} tétel`}
          note={
            shown.mine[0]?.overdueSince
              ? "Ezekkel most tudsz lépni. Az elsőn már késésben vagy."
              : "Ezekkel most tudsz lépni."
          }
          tone="mine"
          items={shown.mine}
        />
      ) : null}

      {shown && view === "OPEN" && shown.others.length > 0 ? (
        <WorkGroup
          testId="group-others"
          title={`Máson múlik · ${shown.others.length} tétel`}
          note="Nem a te mulasztásod. Ezekkel most nincs mit tenned, amíg a másik fél nem lép."
          tone="others"
          items={shown.others}
        />
      ) : null}

      {shown && view === "CLOSED" && shown.closed.length > 0 ? (
        <ul className="space-y-3" data-testid="group-closed">
          {shown.closed.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <WorkCard item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WorkGroup({
  testId,
  title,
  note,
  tone,
  items,
}: {
  testId: string;
  title: string;
  note: string;
  tone: "mine" | "others";
  items: MyServiceWorkItem[];
}) {
  return (
    <section
      data-testid={testId}
      className={`rounded-xl border p-5 ${
        tone === "mine"
          ? "border-pilot-aqua-100 bg-pilot-aqua-50"
          : "border-pilot-amber-100 bg-pilot-amber-50"
      }`}
    >
      <h2
        className={`text-base font-semibold ${
          tone === "mine" ? "text-pilot-aqua-800" : "text-pilot-amber-700"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-1 text-sm ${
          tone === "mine" ? "text-pilot-aqua-700" : "text-pilot-amber-700"
        }`}
      >
        {note}
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <WorkCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkCard({ item }: { item: MyServiceWorkItem }) {
  const overdue = serviceWorkOverdueText(item);
  const place = [item.partnerName, item.unitName].filter(Boolean).join(" · ");
  return (
    <Link
      href={serviceWorkHref(item)}
      data-testid={`work-${item.kind}-${item.id}`}
      className="block rounded-lg border border-dusk-200 bg-white p-4 hover:border-dusk-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-dusk-500">
          {SERVICE_WORK_KIND_LABEL[item.kind]}
        </span>
        <span className="text-base font-semibold text-dusk-900">
          {item.number ?? "Számozatlan munkalap"}
        </span>
        <ServiceStatusBadge tone={serviceWorkStatusTone(item)}>
          {serviceWorkStatusLabel(item)}
        </ServiceStatusBadge>
      </div>
      <p className="mt-1 text-sm text-dusk-600">
        {[place, serviceWorkNextStep(item)].filter(Boolean).join(" · ")}
      </p>
      {overdue ? (
        <p className="mt-1 text-sm font-semibold text-pilot-red-700">
          {overdue}
        </p>
      ) : null}
    </Link>
  );
}
