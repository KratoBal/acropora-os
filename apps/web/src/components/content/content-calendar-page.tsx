"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  CALENDAR_EVENT_KIND_LABELS,
  CONTENT_CALENDAR_UNKNOWN,
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type CalendarEvent,
  type ContentCalendarEntry,
  type ContentCalendarFeed,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentCalendarApi } from "@/lib/api/content-calendar";
import { urlChoice, useUrlQuery } from "@/lib/navigation/use-url-query";
import {
  budapestToday,
  coversDay,
  dayLabel,
  dayOfMonth,
  monthLabel,
  shiftAnchor,
  shortDayLabel,
  validDay,
  viewDays,
  type CalendarView,
} from "./content-calendar-days";
import { ContentCalendarEventForm } from "./content-calendar-event-form";
import { CHANNEL_LABELS } from "./content-history";
import { CONTENT_STATE_LABELS } from "./content-labels";

const VIEWS: CalendarView[] = ["het", "honap"];
const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];
/** Ennyi bejegyzés fér egy hónap-nézeti napba; a többit egy „+N" sor mondja ki, nem hallgatja el. */
const MONTH_CELL_MAX = 3;

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const KIND: Record<
  ContentCalendarEntry["kind"],
  { label: string; tone: BadgeTone; bar: string }
> = {
  EVENT: { label: "Esemény", tone: "danger", bar: "border-l-rose-500" },
  SALE: { label: "Akció", tone: "warning", bar: "border-l-amber-500" },
  LIVESTOCK_ARRIVAL: {
    label: "Élőállat-érkezés",
    tone: "success",
    bar: "border-l-emerald-500",
  },
  PURCHASE_ARRIVAL: {
    label: "Beszerzés érkezik",
    tone: "neutral",
    bar: "border-l-dusk-400",
  },
  CONTENT: { label: "Tartalom", tone: "info", bar: "border-l-sky-500" },
};

const kindLabel = (entry: ContentCalendarEntry) =>
  entry.kind === "EVENT"
    ? CALENDAR_EVENT_KIND_LABELS[entry.eventKind]
    : KIND[entry.kind].label;

const timeFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Budapest",
});

/** Hová visz a bejegyzés: a forrása, ha a néző oda be is léphet (egy link, ami 403-at ad, rosszabb a semminél). */
function sourceHref(
  entry: ContentCalendarEntry,
  user: AuthenticatedUser,
): string | null {
  switch (entry.kind) {
    case "CONTENT":
      return `/tartalom/${encodeURIComponent(entry.contentId)}`;
    case "LIVESTOCK_ARRIVAL":
      return hasPermission(user, PERMISSIONS.INVENTORY_VIEW)
        ? "/elo-allat-erkezesek"
        : null;
    case "PURCHASE_ARRIVAL":
      return hasPermission(user, PERMISSIONS.PURCHASING_VIEW)
        ? `/beszerzes/${encodeURIComponent(entry.purchaseOrderId)}`
        : null;
    case "SALE":
      return entry.products.length === 1 &&
        hasPermission(user, PERMISSIONS.PRODUCTS_VIEW)
        ? `/products/${encodeURIComponent(entry.products[0]!.id)}`
        : null;
    case "EVENT":
      return null;
  }
}

/** A bejegyzés másodlagos sora: ami a címből nem látszik. */
function details(entry: ContentCalendarEntry, queriedAt: string): string[] {
  switch (entry.kind) {
    case "CONTENT":
      return [
        CHANNEL_LABELS[entry.channel],
        CONTENT_STATE_LABELS[entry.state] ?? entry.state,
      ];
    case "LIVESTOCK_ARRIVAL":
      return entry.quantity ? [`${entry.quantity} db`] : [];
    case "PURCHASE_ARRIVAL":
      return [];
    case "SALE":
      return [
        // the unknown start and the open end are in the span label (`describe`), not said twice
        entry.source,
        // spec 8A: minden akción az adat ideje
        `az adat ideje: ${timeFormatter.format(new Date(queriedAt))}`,
      ];
    case "EVENT":
      return [
        ...(entry.location ? [entry.location] : []),
        ...(entry.responsible
          ? [`felelős: ${entry.responsible.name ?? "ismeretlen felhasználó"}`]
          : []),
      ];
  }
}

/** A bejegyzés teljes másodlagos sora: a tartama (ha több nap vagy ismeretlen), és a részletei. */
function describe(entry: ContentCalendarEntry, queriedAt: string): string[] {
  const span = spanLabel(entry);
  return [...(span ? [span] : []), ...details(entry, queriedAt)];
}

function spanLabel(entry: ContentCalendarEntry): string | null {
  if (entry.startsOn === entry.endsOn) return null;
  const from =
    entry.startsOn === CONTENT_CALENDAR_UNKNOWN
      ? "ismeretlen kezdet"
      : shortDayLabel(entry.startsOn);
  const to =
    entry.endsOn === null
      ? "nyitott vég"
      : entry.endsOn === CONTENT_CALENDAR_UNKNOWN
        ? "ismeretlen vég"
        : shortDayLabel(entry.endsOn);
  return `${from} – ${to}`;
}

/**
 * A TARTALOMNAPTÁR (T5.5 S3, spec: exchange/otletek-2026-11-03/t5-5-tartalomnaptar-spec.md). Egy időszak eseményei
 * egy helyen: a kézzel felvitt bolti események és ünnepek, az akciók, az élőállat- és beszerzési érkezések és a
 * tervezett tartalmak. Heti és havi nézet, telefonon napokra bontott lista.
 *
 * A HIBA NEM ÜRES NAPTÁR (spec 8B): ha bármelyik forrás olvasása bukik, a szerver 503-at ad, és az oldal azt mondja
 * ki, hogy az adat nem elérhető. Egy üres rács itt azt hazudná, hogy a héten nincs akció és nincs érkezés.
 */
export function ContentCalendarPage() {
  const { session } = useAuth();
  const { params, update } = useUrlQuery();
  const today = budapestToday();
  const view = urlChoice<CalendarView>(params, "nezet", VIEWS, "het");
  const anchor = validDay(params.get("nap"), today);
  const days = viewDays(view, anchor);
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const [feed, setFeed] = useState<ContentCalendarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    event: CalendarEvent | null;
    day: string;
  } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const canView = Boolean(
    user && hasPermission(user, PERMISSIONS.CONTENT_VIEW),
  );
  const canManage = Boolean(
    user && hasPermission(user, PERMISSIONS.CONTENT_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setFeed(await contentCalendarApi.feed(token, from, to, signal));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setFeed(null);
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, token, from, to],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function openEvent(eventId: string) {
    setOpenError(null);
    try {
      // frissen olvasva: a mentés ennek az updatedAt-jét küldi
      const event = await contentCalendarApi.event(token, eventId);
      setEditing({ event, day: event.startsOn });
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
    }
  }

  if (!user) return null;
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod a tartalomnaptárhoz"
        description="A naptárt a tartalmat olvasó kollégák látják."
      />
    );

  const setView = (next: CalendarView) =>
    update({ nezet: next === "het" ? null : next });
  const setAnchor = (next: string) =>
    update({ nap: next === today ? null : next });
  const entries = feed?.entries ?? [];
  const onDay = (day: string) => entries.filter((e) => coversDay(e, day));
  // a telefonos listában egy többnapos bejegyzés EGYSZER áll, az első látható napján, a tartamával: hétszer ismételve
  // egy futó akció kitöltené a képernyőt, és elnyomná azt, ami aznap kezdődik
  const firstShown = (entry: ContentCalendarEntry) =>
    days.find((day) => coversDay(entry, day));
  const startsListOn = (day: string) =>
    onDay(day).filter((entry) => firstShown(entry) === day);
  const inMonth = (day: string) => day.slice(0, 7) === anchor.slice(0, 7);
  const rangeLabel =
    view === "het"
      ? `${shortDayLabel(from)} – ${shortDayLabel(to)}`
      : monthLabel(anchor);

  const entryProps = (entry: ContentCalendarEntry) => ({
    entry,
    href: sourceHref(entry, user),
    onOpenEvent:
      entry.kind === "EVENT" && canManage
        ? () => void openEvent(entry.eventId)
        : undefined,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tartalomnaptár"
        description="Események, ünnepek, akciók, érkezések és tervezett tartalmak egy helyen."
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/tartalom"
              className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              ← Tartalom
            </Link>
            {canManage ? (
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    event: null,
                    day: from <= today && today <= to ? today : from,
                  })
                }
              >
                Új esemény
              </Button>
            ) : null}
          </div>
        }
      />

      {editing ? (
        <ContentCalendarEventForm
          key={editing.event?.id ?? "new"}
          token={token}
          event={editing.event}
          defaultDay={editing.day}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {openError ? (
        <Alert
          variant="danger"
          title="Az esemény nem nyitható meg"
          description={openError}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-dusk-200 p-0.5">
          {VIEWS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={value === view ? "primary" : "ghost"}
              aria-pressed={value === view}
              onClick={() => setView(value)}
            >
              {value === "het" ? "Hét" : "Hónap"}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          aria-label="Előző"
          onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
        >
          ←
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(today)}>
          Ma
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label="Következő"
          onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
        >
          →
        </Button>
        <span className="text-sm font-medium text-dusk-900">{rangeLabel}</span>
      </div>

      {error ? (
        <Alert
          variant="danger"
          title="Az adat nem elérhető"
          description={`${error} Ez hiba, nem üres naptár: nem jelenti, hogy nincs esemény, akció vagy érkezés.`}
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Újra
            </Button>
          }
        />
      ) : loading && !feed ? (
        <Skeleton className="h-96 w-full" data-testid="calendar-loading" />
      ) : feed ? (
        <>
          {feed.withoutDay.purchaseOrders > 0 ? (
            <p className="text-sm text-dusk-600">
              {feed.withoutDay.purchaseOrders} nyitott beszerzési rendelésnek
              nincs várt napja, ezért a naptáron nem látszik.
            </p>
          ) : null}
          {entries.length === 0 ? (
            <EmptyState
              title="Ebben az időszakban nincs bejegyzés"
              description="Nincs esemény, akció, érkezés vagy tervezett tartalom a kiválasztott napokon."
            />
          ) : (
            <>
              {/* telefonon napokra bontott lista: egy hét oszlopai 390 px-en olvashatatlanok */}
              <div className="space-y-4 md:hidden" data-testid="calendar-list">
                {days
                  .filter((day) => startsListOn(day).length > 0)
                  .map((day) => (
                    <section key={day} className="space-y-2">
                      <h3
                        className={`text-sm font-semibold ${day === today ? "text-brand-700" : "text-dusk-900"}`}
                      >
                        {dayLabel(day)}
                        {day === today ? " (ma)" : ""}
                      </h3>
                      {startsListOn(day).map((entry) => (
                        <CalendarEntryRow
                          key={entry.key}
                          {...entryProps(entry)}
                          queriedAt={feed.queriedAt}
                        />
                      ))}
                    </section>
                  ))}
              </div>
              <Card
                className="hidden overflow-hidden md:block"
                data-testid="calendar-grid"
              >
                <div className="grid grid-cols-7 border-b border-dusk-200 bg-dusk-50 text-xs font-medium text-dusk-600">
                  {WEEKDAYS.map((name) => (
                    <div key={name} className="px-2 py-1.5">
                      {name}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((day) => {
                    const list = onDay(day);
                    const shown =
                      view === "honap" ? list.slice(0, MONTH_CELL_MAX) : list;
                    return (
                      <div
                        key={day}
                        className={`min-h-28 space-y-1 border-b border-r border-dusk-100 p-1.5 ${view === "honap" && !inMonth(day) ? "bg-dusk-50/60" : ""}`}
                      >
                        <div
                          className={`text-xs ${day === today ? "font-bold text-brand-700" : "text-dusk-500"}`}
                        >
                          {view === "het"
                            ? shortDayLabel(day)
                            : dayOfMonth(day)}
                        </div>
                        {shown.map((entry) => (
                          <CalendarEntryChip
                            key={entry.key}
                            {...entryProps(entry)}
                            queriedAt={feed.queriedAt}
                            full={view === "het"}
                          />
                        ))}
                        {list.length > shown.length ? (
                          <button
                            type="button"
                            className="text-xs text-brand-700 hover:underline"
                            onClick={() => {
                              update({ nezet: null, nap: day });
                            }}
                          >
                            +{list.length - shown.length} további
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

interface EntryProps {
  entry: ContentCalendarEntry;
  href: string | null;
  queriedAt: string;
  onOpenEvent?: () => void;
}

function EntryTitle({ entry, href, onOpenEvent }: EntryProps) {
  if (href)
    return (
      <Link href={href} className="font-medium text-dusk-900 hover:underline">
        {entry.title}
      </Link>
    );
  if (onOpenEvent)
    return (
      <button
        type="button"
        className="text-left font-medium text-dusk-900 hover:underline"
        onClick={onOpenEvent}
      >
        {entry.title}
      </button>
    );
  return <span className="font-medium text-dusk-900">{entry.title}</span>;
}

/** Telefonos sor: minden adat kiírva. */
function CalendarEntryRow(props: EntryProps) {
  const { entry, queriedAt } = props;
  return (
    <div
      className={`rounded-lg border border-dusk-200 border-l-4 bg-white p-3 text-sm ${KIND[entry.kind].bar}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={KIND[entry.kind].tone}>{kindLabel(entry)}</Badge>
        <EntryTitle {...props} />
      </div>
      <p className="mt-1 text-xs text-dusk-600">
        {describe(entry, queriedAt).join(" · ")}
      </p>
    </div>
  );
}

/** Rács-cella bejegyzése: a heti nézetben a részletekkel, a havi nézetben egy sorban, a többi a címkében (title). */
function CalendarEntryChip(props: EntryProps & { full: boolean }) {
  const { entry, queriedAt, full } = props;
  const extra = describe(entry, queriedAt);
  return (
    <div
      className={`rounded border-l-4 bg-dusk-50 px-1.5 py-1 text-xs ${KIND[entry.kind].bar}`}
      title={[kindLabel(entry), entry.title, ...extra].join(" · ")}
    >
      <div
        className={
          full
            ? ""
            : "truncate [&_button]:block [&_button]:w-full [&_button]:truncate"
        }
      >
        <EntryTitle {...props} />
      </div>
      {full ? (
        <div className="mt-0.5 text-[11px] text-dusk-600">
          {[kindLabel(entry), ...extra].join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
