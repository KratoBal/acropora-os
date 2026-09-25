"use client";

import { Alert, Icon, Skeleton, type IconName } from "@acropora/ui";
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
  PilotAvatar,
  PilotBadge,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
  pilotAvatarColor,
  pilotInitials,
} from "@/components/pilot/pilot-ui";
import { serviceJobStatusLabel } from "@/components/service-jobs/service-job-labels";
import { dashboardApi } from "@/lib/api/dashboard";
import { personGivenName } from "@acropora/types";

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

/**
 * HÁNY NAP VAN HÁTRA EGY DÁTUMIG -- csak a NAP számít, az óra nem (a
 * `dateOnly` a szerveren is csak a napot adja). Negatív, ha már elmúlt.
 */
function daysUntil(dateOnly: string): number {
  const today = new Date();
  const target = new Date(dateOnly);
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const targetUtc = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.round((targetUtc - todayUtc) / msPerDay);
}

/**
 * A "X nap" JELZŐ -- a terv szerint sárga, ha 7 napon belül van, egyébként
 * szürke (`DashboardScreen.tsx` `SERVICE_KARBANTARTASOK` sora). Ugyanezt a
 * küszöböt használja az "Esedékes karbantartások" kártya.
 */
function DaysPill({ days }: { days: number }) {
  const urgent = days <= 7;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${
        urgent
          ? "bg-amber-50 text-amber-700"
          : "bg-pilot-grey-100 text-pilot-grey-600"
      }`}
    >
      {days < 0 ? `${Math.abs(days)} napja lejárt` : `${days} nap`}
    </span>
  );
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

/**
 * A KARTYA-FEJLEC IKONJA KEREKITETT SZURKE HATTER-DOBOZBAN (a terv szerint,
 * `DashboardScreen.tsx:76-92`, `w-7 h-7 rounded-lg bg-grey-50`). Ez a
 * kezdolap SAJAT tervenek mintaja -- a portal `CardHeader`-je (`Partner
 * PortalScreen.tsx:280-292`) nem ismer icon-propot egyaltalan, tehat ez
 * NEM a megosztott `PilotCardHeader`-t erinti, csak a kezdolap sajat
 * `DashboardCard`-jat: az ikon itt kap dobozt, a tobbi pilot-lap sajat
 * ikon-elhelyezese valtozatlan marad.
 */
function DashboardCard({
  children,
  empty,
  href,
  title,
  icon,
  iconClassName,
}: {
  children: ReactNode;
  empty: boolean;
  href?: string;
  title: string;
  icon?: IconName;
  iconClassName?: string;
}) {
  return (
    <PilotCard>
      <PilotCardHeader
        title={title}
        icon={
          icon ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pilot-grey-50">
              <Icon name={icon} size={14} className={iconClassName} />
            </span>
          ) : undefined
        }
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

/*
  A NÉGY CSEMPE FELIRATA A TERV RÖVID ALAKJÁRA VÁLTOTT ("Nyitott hibajegy",
  nem "Nyitott hibajegyek") -- a `DashboardScreen.tsx` `OWNER_TILES` tömbje
  szerint, ugyanabban a sorrendben és ugyanazzal a szín/ikon-párral
  (`iconColorMap`/`colorMap`), a `teal`/`grey` szócsalád `pilot-*`-ra
  fordítva, a többi (amber/blue/red) változatlanul, ahogy a repó más pilot
  lapjain is (lásd `pilot-aquarium-water-values.tsx` `text-amber-600`-ját).
*/
const MANAGER_TILE_STYLE = {
  amber: { bg: "bg-amber-50", icon: "text-amber-600" },
  blue: { bg: "bg-blue-50", icon: "text-blue-700" },
  grey: { bg: "bg-pilot-grey-100", icon: "text-pilot-grey-500" },
  red: { bg: "bg-red-50", icon: "text-red-600" },
} as const;

function ManagerTiles({
  data,
}: {
  data: NonNullable<DashboardSummary["managerTiles"]>;
}) {
  const tiles = [
    {
      href: "/szerviz/hibajegyek",
      label: "Nyitott hibajegy",
      value: data.openTickets,
      icon: "service",
      color: "amber",
    },
    {
      href: "/szerviz/munkalapok",
      label: "Aláírásra vár",
      value: data.worksheetsWaitingForSignature,
      icon: "clipboard",
      color: "blue",
    },
    {
      href: "/szerviz/anyagigenyek",
      label: "Anyagigény",
      value: data.materialRequestsWaiting,
      icon: "box",
      color: "grey",
    },
    {
      href: "/szerviz/karbantartas",
      label: "Megrendelőlap",
      value: data.maintenanceOrderFormsWaitingForSignature,
      icon: "calendar",
      color: "red",
    },
  ] as const;

  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Szerviz áttekintés"
    >
      {tiles.map((tile) => {
        const style = MANAGER_TILE_STYLE[tile.color];
        return (
          <Link
            key={tile.label}
            href={tile.href}
            className="flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-pilot-grey-200 transition-colors hover:bg-pilot-grey-50"
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.bg}`}
            >
              <Icon name={tile.icon} size={18} className={style.icon} />
            </div>
            <div>
              <p className="font-mono text-2xl font-semibold tabular-nums text-pilot-grey-900">
                {tile.value}
              </p>
              <p className="mt-0.5 text-xs text-pilot-grey-500">{tile.label}</p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

export function DashboardCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="space-y-5">
      {summary.managerTiles ? (
        <ManagerTiles data={summary.managerTiles} />
      ) : null}

      {/*
        "LEGUTOBBI AKTIVITASOK" KULON, 340PX-ES OLDALSAVBAN (a terv szerint,
        `DashboardScreen.tsx:319,387-399`) -- korabban ugyanabban a lapos
        kartya-racsban allt, mint minden mas kartya. A tobbi kartya
        elrendezese (ket oszlop `lg:`-tol) valtozatlan, csak az Activity
        kartya kerult ki sajat oszlopba.
      */}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px] xl:items-start">
        <section className="grid gap-5 lg:grid-cols-2">
          {summary.myWorksheets ? (
            <DashboardCard
              title="Saját munkalapjaim"
              href="/szerviz/munkalapok"
              icon="clipboard"
              iconClassName="text-pilot-grey-400"
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
              icon="service"
              iconClassName="text-amber-600"
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

          {/*
          ÚJ KÁRTYA (2026-09-25, Figma-igazítás) -- `Asset.nextServiceAt`-ből,
          lásd a szerver oldali `upcomingMaintenance()` fejlécét a hatókörről
          és az időablakról.
        */}
          {summary.upcomingMaintenance ? (
            <DashboardCard
              title="Esedékes karbantartások"
              href="/szerviz/eszkozok"
              icon="calendar"
              iconClassName="text-pilot-grey-400"
              empty={summary.upcomingMaintenance.items.length === 0}
            >
              {summary.upcomingMaintenance.items.length === 0 ? (
                "Nincs esedékes karbantartás."
              ) : (
                <ul className="space-y-3">
                  {summary.upcomingMaintenance.items.map((item) => (
                    <li
                      key={item.assetId}
                      className="flex items-center justify-between gap-3"
                    >
                      <Link
                        href={`/szerviz/eszkozok/${item.assetId}`}
                        className="min-w-0 text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                      >
                        <span className="block truncate">{item.assetName}</span>
                        <span className="mt-1 block text-xs font-normal text-pilot-grey-500">
                          {item.customerName ? `${item.customerName} · ` : ""}
                          {item.departmentName} ·{" "}
                          {formatDate(item.nextServiceAt)}
                        </span>
                      </Link>
                      <DaysPill days={daysUntil(item.nextServiceAt)} />
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>
          ) : null}

          {/*
          A "HJ"/"ML" CÍMKÉZETT SOROK A TERVBEN (mindkét típusú határidő)
          MA NEM ÉPÍTHETŐK: a `DashboardDeadline.kind` egyetlen értéket ismer
          (`"WORKSHEET"`), hibajegy-határidőt a lekérdezés sosem adott --
          lásd `dashboard.ts` típusát. Ez valódi, meglévő hiány, nem ennek a
          körnek az újítása; a PR törzsében szerepel.
        */}
          {summary.deadlines ? (
            <DashboardCard
              title="Határidők"
              href="/szerviz/munkalapok"
              icon="calendar"
              iconClassName="text-amber-600"
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
              title="Csapat – nyitott munkalapok"
              href="/szerviz/munkalapok"
              icon="users"
              iconClassName="text-pilot-grey-400"
              empty={summary.teamLoad.items.length === 0}
            >
              {summary.teamLoad.items.length === 0 ? (
                "Nincs nyitott munkalap a csapatnál."
              ) : (
                <ul className="space-y-3">
                  {(() => {
                    const maxOpen = Math.max(
                      1,
                      ...summary.teamLoad.items.map(
                        (item) => item.openWorksheetCount,
                      ),
                    );
                    return summary.teamLoad.items.map((item) => (
                      <li
                        key={item.userId}
                        className="flex items-center gap-3 text-sm"
                      >
                        <PilotAvatar
                          initials={pilotInitials(item.displayName)}
                          color={pilotAvatarColor(item.userId)}
                          size="sm"
                        />
                        <span className="flex-1 truncate font-medium text-pilot-grey-800">
                          {item.displayName}
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-24 rounded-full bg-pilot-grey-100">
                            <div
                              className="h-1.5 rounded-full bg-pilot-aqua-500"
                              style={{
                                width: `${(item.openWorksheetCount / maxOpen) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right font-mono text-xs text-pilot-grey-600">
                            {item.openWorksheetCount} nyitott
                          </span>
                        </div>
                      </li>
                    ));
                  })()}
                </ul>
              )}
            </DashboardCard>
          ) : null}

          {summary.aquariumAlerts ? (
            <DashboardCard
              title="Akváriumok – figyelmeztetések"
              href="/akvariumok"
              icon="droplet"
              iconClassName="text-pilot-grey-400"
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
              title="Anyagigények – teljesítésre vár"
              href="/szerviz/anyagigenyek"
              icon="box"
              iconClassName="text-amber-600"
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
                          {item.worksheetNumber ?? "Munkalap azonosító nélkül"}{" "}
                          ·{" "}
                          {dateTimeFormatter.format(new Date(item.submittedAt))}
                        </span>
                      </Link>
                      {/*
                      A TERV EGYETLEN ANYAG+MENNYISEG PART MUTAT SORONKENT
                      (`WH_ANYAGIGENYEK` demo), de a valodi anyagigeny tobb
                      tetelt is hordozhat -- lasd a szerver oldali
                      `materialRequests()` fejlecet. A darabszam ("N tétel")
                      jobbra igazitva, monospace, ugyanaz a hely, ahol a
                      terv a mennyiseget mutatja.
                    */}
                      <span className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold text-pilot-grey-700">
                        {item.itemCount} tétel
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>
          ) : null}

          {/*
          A TERV EGY VALÓDI TÁBLÁZATOT AD (Nyilvántartott/Tényleges/Eltérés
          OSZLOPOKKAL, konkrét darabszámokkal) -- ez a mai adatból NEM
          ÉPÍTHETŐ: a `DashboardInventoryDiscrepancy` típus csak `sku`-t,
          `warehouseCode`-ot és `status`-t hordoz, tényleges/nyilvántartott
          SZÁMOT nem. A cím és az ikon a tervhez igazodik, a sor-tartalom
          marad a mai (SKU + raktárkód) -- ez a PR-ben is szerepel, nem
          hallgatva el.
        */}
          {summary.inventoryDiscrepancies ? (
            <DashboardCard
              title="Leltár – eltérések"
              href="/keszlet-egyeztetes"
              icon="alert"
              iconClassName="text-red-600"
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
        </section>

        {summary.activity ? (
          <div className="flex flex-col gap-5">
            <ActivityCard data={summary.activity} />
          </div>
        ) : null}
      </div>
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
      icon="activity"
      iconClassName="text-pilot-grey-400"
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
    ? personGivenName(session.user)
    : undefined;
  const greeting = getGreeting(new Date().getHours());

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-6 lg:-m-8 lg:p-8">
      {/*
        A TARTALOM KOZEPRE IGAZITVA, SZELESSEG-KORLATTAL, A TERV SZERINT
        (`DashboardScreen.tsx:530`, `max-w-6xl mx-auto w-full`) -- korabban
        a tartalom a keret teljes szelesseget kitoltotte. A szurke hatter
        (fent, a `PilotThemeRoot`-on) tovabbra is teli szelessegu, csak a
        BENNE allo doboz kap korlatot es kozepre-igazitast.
      */}
      <div className="mx-auto w-full max-w-6xl">
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
      </div>
    </PilotThemeRoot>
  );
}
