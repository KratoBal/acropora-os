"use client";

import { Alert, Skeleton } from "@acropora/ui";
import {
  worksheetStatusLabel,
  type DashboardActivity,
  type DashboardSummary,
} from "@acropora/types";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { serviceJobStatusLabel } from "@/components/service-jobs/service-job-labels";
import { dashboardApi } from "@/lib/api/dashboard";
import { personDisplayName } from "@acropora/types";

function getGreeting(hour: number) {
  if (hour < 10) return "Jó reggelt";
  if (hour < 18) return "Jó napot";
  return "Jó estét";
}

const todayFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "Nincs határidő";
}

function worksheetStatusText(status: string) {
  return Object.hasOwn(worksheetStatusLabel, status)
    ? worksheetStatusLabel[status as keyof typeof worksheetStatusLabel]
    : status;
}

function ticketStatusText(status: string) {
  return Object.hasOwn(serviceJobStatusLabel, status)
    ? serviceJobStatusLabel[status as keyof typeof serviceJobStatusLabel]
    : status;
}

function DashboardCard({
  children,
  empty,
  href,
  title,
}: {
  children: ReactNode;
  empty: boolean;
  href?: string;
  title: string;
}) {
  return (
    <PilotCard>
      <PilotCardHeader
        title={title}
        action={
          href ? (
            <Link
              href={href}
              className="text-xs font-medium text-pilot-aqua-700 hover:text-pilot-aqua-800"
            >
              Lista megnyitása
            </Link>
          ) : undefined
        }
      />
      <div className="p-5">
        {empty ? (
          <p className="text-sm text-pilot-grey-500">{children}</p>
        ) : (
          children
        )}
      </div>
    </PilotCard>
  );
}

function DashboardLoading() {
  return (
    <div
      className="grid gap-5 lg:grid-cols-2"
      aria-label="Irányítópult betöltése"
    >
      {["one", "two", "three", "four"].map((key) => (
        <PilotCard key={key} className="p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-4/5" />
        </PilotCard>
      ))}
    </div>
  );
}

function ManagerTiles({
  data,
}: {
  data: NonNullable<DashboardSummary["managerTiles"]>;
}) {
  const tiles = [
    {
      href: "/szerviz/hibajegyek",
      label: "Nyitott hibajegyek",
      value: data.openTickets,
    },
    {
      href: "/szerviz/munkalapok",
      label: "Aláírásra váró munkalapok",
      value: data.worksheetsWaitingForSignature,
    },
    {
      href: "/szerviz/anyagigenyek",
      label: "Nyitott anyagigények",
      value: data.materialRequestsWaiting,
    },
    {
      href: "/szerviz/karbantartas",
      label: "Aláírásra váró karbantartási megrendelők",
      value: data.maintenanceOrderFormsWaitingForSignature,
    },
  ];

  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Szerviz áttekintés"
    >
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="rounded-xl bg-white p-4 ring-1 ring-pilot-grey-200 transition-colors hover:bg-pilot-grey-50"
        >
          <p className="text-xs font-medium text-pilot-grey-500">
            {tile.label}
          </p>
          <p className="mt-3 text-2xl font-semibold text-pilot-grey-900">
            {tile.value}
          </p>
        </Link>
      ))}
    </section>
  );
}

export function DashboardCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="space-y-5">
      {summary.managerTiles ? (
        <ManagerTiles data={summary.managerTiles} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        {summary.myWorksheets ? (
          <DashboardCard
            title="Saját munkalapjaim"
            href="/szerviz/munkalapok"
            empty={summary.myWorksheets.items.length === 0}
          >
            {summary.myWorksheets.items.length === 0 ? (
              "Nincs nyitott munkalapod."
            ) : (
              <ul className="space-y-3">
                {summary.myWorksheets.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <Link
                      href={`/szerviz/munkalapok/${item.id}`}
                      className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                    >
                      <span className="block truncate">{item.subject}</span>
                      <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                        {item.number ?? "Munkalap azonosító nélkül"} ·{" "}
                        {formatDate(item.deadline)}
                      </span>
                    </Link>
                    <PilotBadge variant="grey">
                      {worksheetStatusText(item.status)}
                    </PilotBadge>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        ) : null}

        {summary.openTickets ? (
          <DashboardCard
            title="Nyitott hibajegyek a helyszíneimen"
            href="/szerviz/hibajegyek"
            empty={summary.openTickets.items.length === 0}
          >
            {summary.openTickets.items.length === 0 ? (
              "Nincs nyitott hibajegy a helyszíneiden."
            ) : (
              <>
                <p className="mb-3 text-xs text-pilot-grey-500">
                  {summary.openTickets.count} nyitott hibajegy
                </p>
                <ul className="space-y-3">
                  {summary.openTickets.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <Link
                        href={`/szerviz/hibajegyek/${item.id}`}
                        className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                      >
                        <span className="block truncate">{item.title}</span>
                        <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                          {item.number} ·{" "}
                          {dateTimeFormatter.format(new Date(item.createdAt))}
                        </span>
                      </Link>
                      <PilotBadge variant="grey">
                        {ticketStatusText(item.status)}
                      </PilotBadge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DashboardCard>
        ) : null}

        {summary.deadlines ? (
          <DashboardCard
            title="Határidők"
            href="/szerviz/munkalapok"
            empty={summary.deadlines.items.length === 0}
          >
            {summary.deadlines.items.length === 0 ? (
              "Nincs közelgő határidő."
            ) : (
              <ul className="space-y-3">
                {summary.deadlines.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <Link
                      href={`/szerviz/munkalapok/${item.id}`}
                      className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                    >
                      <span className="block truncate">{item.subject}</span>
                      <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                        {item.number ?? "Munkalap azonosító nélkül"}
                      </span>
                    </Link>
                    <PilotBadge variant="amber">
                      {formatDate(item.deadline)}
                    </PilotBadge>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        ) : null}

        {summary.teamLoad ? (
          <DashboardCard
            title="Csapat"
            href="/szerviz/munkalapok"
            empty={summary.teamLoad.items.length === 0}
          >
            {summary.teamLoad.items.length === 0 ? (
              "Nincs nyitott munkalap a csapatnál."
            ) : (
              <ul className="space-y-3">
                {summary.teamLoad.items.map((item) => (
                  <li
                    key={item.userId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="font-medium text-pilot-grey-800">
                      {item.displayName}
                    </span>
                    <span className="text-pilot-grey-500">
                      {item.openWorksheetCount} nyitott munkalap
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        ) : null}

        {summary.aquariumAlerts ? (
          <DashboardCard
            title="Akváriumok"
            href="/akvariumok"
            empty={summary.aquariumAlerts.items.length === 0}
          >
            {summary.aquariumAlerts.items.length === 0 ? (
              "Nincs figyelmeztető akváriumjelzés."
            ) : (
              <ul className="space-y-3">
                {summary.aquariumAlerts.items.map((item) => (
                  <li
                    key={`${item.aquariumId}-${item.reason}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <Link
                      href={`/akvariumok/${item.aquariumId}/meresek`}
                      className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                    >
                      <span className="block truncate">
                        {item.aquariumName}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                        {item.reason === "OUT_OF_RANGE"
                          ? "Céltartományon kívüli érték"
                          : "Vízmérés esedékes"}
                      </span>
                    </Link>
                    <PilotBadge
                      variant={
                        item.reason === "OUT_OF_RANGE" ? "danger" : "amber"
                      }
                    >
                      {item.reason === "OUT_OF_RANGE"
                        ? "Figyelmeztetés"
                        : "Esedékes"}
                    </PilotBadge>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        ) : null}

        {summary.materialRequests ? (
          <DashboardCard
            title="Anyagigények"
            href="/szerviz/anyagigenyek"
            empty={summary.materialRequests.items.length === 0}
          >
            {summary.materialRequests.items.length === 0 ? (
              "Nincs nyitott anyagigény."
            ) : (
              <ul className="space-y-3">
                {summary.materialRequests.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <Link
                      href={`/szerviz/munkalapok/${item.worksheetId}`}
                      className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                    >
                      <span className="block truncate">
                        {item.customerName}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                        {item.worksheetNumber ?? "Munkalap azonosító nélkül"} ·{" "}
                        {dateTimeFormatter.format(new Date(item.submittedAt))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        ) : null}

        {summary.inventoryDiscrepancies ? (
          <DashboardCard
            title="Leltár"
            href="/keszlet-egyeztetes"
            empty={summary.inventoryDiscrepancies.items.length === 0}
          >
            {summary.inventoryDiscrepancies.items.length === 0 ? (
              "Nincs készleteltérés."
            ) : (
              <>
                <p className="mb-3 text-xs text-pilot-grey-500">
                  {summary.inventoryDiscrepancies.count} eltérés
                </p>
                <ul className="space-y-3">
                  {summary.inventoryDiscrepancies.items.map((item) => (
                    <li
                      key={item.variantId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="font-medium text-pilot-grey-800">
                        {item.sku}
                      </span>
                      <span className="text-pilot-grey-500">
                        {item.warehouseCode}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DashboardCard>
        ) : null}

        {summary.activity ? <ActivityCard data={summary.activity} /> : null}
      </section>
    </div>
  );
}

function ActivityCard({
  data,
}: {
  data: NonNullable<DashboardSummary["activity"]>;
}) {
  const actionLabel: Record<
    DashboardActivity["items"][number]["kind"],
    string
  > = {
    TICKET_OPENED: "új hibajegyet nyitott",
    WORKSHEET_CLOSED: "munkalapot zárt le",
    MEASUREMENT_RECORDED: "vízmérést rögzített",
  };

  return (
    <DashboardCard
      title="Legutóbbi aktivitások"
      empty={data.items.length === 0}
    >
      {data.items.length === 0 ? (
        "Nincs megjeleníthető aktivitás."
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => (
            <li
              key={`${item.kind}-${item.subject}-${item.occurredAt}`}
              className="text-sm text-pilot-grey-600"
            >
              <span className="font-medium text-pilot-grey-800">
                {item.actorName ?? "Rendszer"}
              </span>{" "}
              {actionLabel[item.kind]}: {item.subject}
              <span className="mt-1 block text-xs text-pilot-grey-500">
                {dateTimeFormatter.format(new Date(item.occurredAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

export default function DashboardPage() {
  const { session } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!session) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    void dashboardApi
      .summary(session.token ?? "", controller.signal)
      .then((next) => setSummary(next))
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Az irányítópult nem tölthető be.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  const greetingName = session?.user
    ? personDisplayName(session.user).split(" ")[0]
    : undefined;
  const greeting = getGreeting(new Date().getHours());

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-6 lg:-m-8 lg:p-8">
      <div className="mb-6">
        <p className="text-sm text-pilot-grey-500">
          {todayFormatter.format(new Date())}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-pilot-grey-900">
          {greetingName ? `${greeting}, ${greetingName}!` : `${greeting}!`}
        </h1>
      </div>

      {loading ? <DashboardLoading /> : null}
      {error ? (
        <Alert
          variant="danger"
          title="Az irányítópult nem tölthető be"
          description={error}
        />
      ) : null}
      {!loading && !error && summary ? (
        <DashboardCards summary={summary} />
      ) : null}
    </PilotThemeRoot>
  );
}
