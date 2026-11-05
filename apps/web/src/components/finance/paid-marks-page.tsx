"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { formatMoney, hasPermission, PERMISSIONS } from "@acropora/types";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { formatDateTimeHu, formatTimeHu } from "@/lib/format/date";
import {
  paidMarksApi,
  type FeedPullLine,
  type PaidMarkAttentionItem,
  type PaidMarkRunView,
  type PaidMarkSource,
  type PaidMarksMode,
  type PaidMarksStatus,
} from "@/lib/api/paid-marks";

import { FeedBackfillPanel } from "./feed-backfill-panel";
import {
  canPullIntoFeed,
  FeedPullButton,
  ManualCloseButton,
  useFeedPreview,
} from "./feed-pull-button";
import { SettlementTabs } from "./settlement-tabs";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

const SOURCE_LABEL: Record<PaidMarkSource, string> = {
  GLS_COD: "GLS utánvét",
  FOXPOST: "Foxpost utánvét",
  SIMPLEPAY: "SimplePay kártyás fizetés",
  BANK_TRANSFER: "Banki átutalás",
};

/** A kapcsoló állása, ahogy a vevő oldaláról számít: ír-e, vagy csak tervez. */
function ModeBadge({ mode }: { mode: PaidMarksMode }) {
  if (mode === "auto")
    return <PilotBadge variant="success">Automatikus: beírja</PilotBadge>;
  if (mode === "dry")
    return <PilotBadge variant="amber">Próba: csak tervez, nem ír</PilotBadge>;
  if (mode === "live")
    return <PilotBadge variant="grey">Kézi jóváhagyással</PilotBadge>;
  return <PilotBadge variant="grey">Kikapcsolva</PilotBadge>;
}

/**
 * Egy figyelmet kérő sor és a gombja (6fd8c574). A „nincs a Számlázz.hu feedben” sornál a Számlázz.hu válasza dönt: ha
 * ismeri a számlát, „Lekérés”; ha nem, a sor kimondja, hogy cmfx-ben kiállított számla, és ott a „Kézzel rendezve”. A
 * banki UNRESOLVED sor (a közlemény száma nincs a feedben) szintén kézzel rendezhető.
 */
function AttentionLine({
  source,
  item,
  canPull,
  answers,
  token,
  onChanged,
}: {
  source: PaidMarkSource;
  item: PaidMarkAttentionItem;
  canPull: boolean;
  answers: ReadonlyMap<string, FeedPullLine> | null;
  token: string;
  onChanged: () => void;
}) {
  const close = (
    <ManualCloseButton
      source={source}
      item={item}
      token={token}
      onDone={onChanged}
    />
  );
  let action: ReactNode = null;
  if (canPull && canPullIntoFeed(item)) {
    const answer = answers?.get(item.reference);
    if (answers === null)
      action = (
        <span className="ml-2 text-pilot-grey-500">
          Számlázz.hu: ellenőrzés…
        </span>
      );
    else if (answer?.outcome === "WOULD_STORE")
      action = (
        <FeedPullButton
          invoiceNumber={item.reference}
          token={token}
          known={answer}
        />
      );
    else if (answer?.outcome === "NOT_FOUND")
      action = (
        <>
          <span className="ml-1" data-testid="not-in-szamlazz">
            · a Számlázz.hu nem ismeri: cmfx-ben kiállított számla, a
            kifizetettet ott kell kézzel jelölni
          </span>
          {close}
        </>
      );
    else
      action = <FeedPullButton invoiceNumber={item.reference} token={token} />;
  } else if (canPull && item.reason === "UNRESOLVED") action = close;
  return (
    <li>
      {item.reference}: {item.reason}
      {item.detail ? ` (${item.detail})` : ""}
      {action}
    </li>
  );
}

/** A kézzel rendezett sorok: ki és mikor zárta le, és a visszavonás. */
function SettledList({
  source,
  settled,
  canUndo,
  token,
  onChanged,
}: {
  source: PaidMarkSource;
  settled: PaidMarkRunView["settled"];
  canUndo: boolean;
  token: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (settled.length === 0) return null;
  const undo = async (item: PaidMarkAttentionItem) => {
    setBusy(true);
    setError(null);
    try {
      await paidMarksApi.closeAttention(token, {
        source,
        key: item.key ?? item.reference,
        reason: item.reason,
        closed: false,
      });
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1" data-testid={`paid-mark-settled-${source}`}>
      <p className="text-xs font-semibold text-pilot-grey-700">
        Kézzel rendezve: {settled.length}
      </p>
      <ul className="space-y-1 text-xs text-pilot-grey-600">
        {settled.map((item) => (
          <li key={`${item.key ?? item.reference}-${item.reason}`}>
            {item.reference}: {item.reason} · {item.closedBy},{" "}
            {formatDateTimeHu(item.closedAt)}
            {canUndo ? (
              <span className="ml-2 inline-flex">
                <PilotButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void undo(item)}
                >
                  Visszavonás
                </PilotButton>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <Alert
          variant="danger"
          title="A visszavonás nem sikerült"
          description={error}
        />
      ) : null}
    </div>
  );
}

/** Egy forrás legutóbbi futása: mikor, ki indította, mit írt, mit tervezne, mi kér figyelmet. */
function SourceRun({
  source,
  mode,
  run,
  canPull,
  token,
  onChanged,
}: {
  source: PaidMarkSource;
  mode: PaidMarksMode;
  run: PaidMarkRunView | undefined;
  /** a „Lekérés a Számlázz.hu-ból” és a „Kézzel rendezve” joga (a „Futtatás most”-é) */
  canPull: boolean;
  token: string;
  /** egy lezárás vagy visszavonás után a futások újraolvasása */
  onChanged: () => void;
}) {
  const answers = useFeedPreview(
    (run?.attention ?? [])
      .filter((item) => canPullIntoFeed(item))
      .map((item) => item.reference),
    token,
    canPull,
  );
  return (
    <li
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid={`paid-mark-source-${source}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{SOURCE_LABEL[source]}</span>
        <ModeBadge mode={mode} />
      </div>
      {!run ? (
        <p className="text-xs text-pilot-grey-600">Még nem futott.</p>
      ) : (
        <>
          <p className="text-xs text-pilot-grey-600">
            Legutóbb: {formatDateTimeHu(run.startedAt)} (
            {run.trigger === "manual" ? "kézi indítás" : "napi futás"}
            {run.mode === "dry" ? ", próba" : ""})
          </p>
          {run.errorCode ? (
            <Alert
              variant="danger"
              title="A futás elbukott"
              description={run.errorCode}
            />
          ) : run.mode === "dry" ? (
            <PlannedList planned={run.planned} />
          ) : (
            <p className="text-sm">
              Beírva: {run.writtenCount}
              {run.failedCount > 0
                ? ` · bizonytalan vagy elutasított: ${run.failedCount}`
                : ""}
            </p>
          )}
          {run.attention.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-pilot-amber-700">
                Figyelmet kér: {run.attention.length}
              </p>
              <ul className="space-y-1 text-xs text-pilot-grey-700">
                {run.attention.map((item) => (
                  <AttentionLine
                    key={`${item.key ?? item.reference}-${item.reason}`}
                    source={source}
                    item={item}
                    canPull={canPull}
                    answers={answers}
                    token={token}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          <SettledList
            source={source}
            settled={run.settled ?? []}
            canUndo={canPull}
            token={token}
            onChanged={onChanged}
          />
        </>
      )}
    </li>
  );
}

/** A próba terve: mit jelölne kifizetettre, számlaszámmal és összeggel. */
function PlannedList({ planned }: { planned: PaidMarkRunView["planned"] }) {
  if (planned.length === 0)
    return (
      <p className="text-sm">Most nem jelölne kifizetettre egy számlát sem.</p>
    );
  const total = planned.reduce((sum, mark) => sum + Number(mark.amount), 0);
  return (
    <div className="space-y-2" data-testid="paid-marks-planned">
      <p className="text-sm">
        Kifizetettre jelölné ({planned.length} számla,{" "}
        {formatMoney(String(total), "HUF")}), ha a kapcsoló automatikus lenne:
      </p>
      <ul className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 text-sm">
        {planned.map((mark) => (
          <li
            key={mark.invoiceNumber}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
          >
            <span className="font-medium">{mark.invoiceNumber}</span>
            <span>{formatMoney(mark.amount, "HUF")}</span>
            <span className="w-full text-xs text-pilot-grey-600 sm:w-auto">
              {mark.date} · {mark.sourceRef}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A KIFIZETETT-JELÖLÉS NAPI FUTÁSA (kártya e64540fd; Balázs, 2026-11-05: "szeretném a futtatás most
 * gombot"). Forrásonként a kapcsoló és a legutóbbi futás; a gomb ugyanazt a futást indítja, ugyanazokkal a
 * kapcsolókkal: ami automatikus, az beír, ami próba, az csak tervet készít. Indítás után a lap néhány
 * másodpercenként megnézi, véget ért-e, és akkor újraolvassa a futásokat.
 */
export function PaidMarksPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canRun = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_ISSUE),
  );
  const [status, setStatus] = useState<PaidMarksStatus | null>(null);
  const [runs, setRuns] = useState<PaidMarkRunView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setError(null);
    try {
      const [nextStatus, nextRuns] = await Promise.all([
        paidMarksApi.status(token),
        paidMarksApi.latest(token),
      ]);
      setStatus(nextStatus);
      setRuns(nextRuns);
      if (nextStatus.running)
        poll.current = setTimeout(() => void load(), 3000);
    } catch (cause) {
      setError(errorText(cause));
      setRuns((current) => current ?? []);
    }
  }, [token, canView]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await paidMarksApi.runNow(token);
      setConfirming(false);
      if (answer.status === "started")
        setNotice("A futás elindult. A lap magától frissül, amikor véget ér.");
      else if (answer.status === "running")
        setNotice("Egy futás már tart: megvárjuk, a lap magától frissül.");
      else
        setNotice(
          "Egyik forrás sincs automatikus vagy próba állásban, nincs mit futtatni.",
        );
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a kifizetett-jelöléshez"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  const latest = new Map((runs ?? []).map((run) => [run.source, run]));
  const running = status?.running ?? false;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description={`${
          status?.nextRunAt
            ? `A kifizetett-jelölés naponta ${formatTimeHu(status.nextRunAt)}-kor fut magától (budapesti idő; legközelebb ${formatDateTimeHu(status.nextRunAt)}).`
            : "A kifizetett-jelölés napi futása most nincs ütemezve."
        } Most is elindíthatod: ugyanaz a futás, ugyanazokkal a kapcsolókkal.`}
        actions={
          canRun ? (
            <PilotButton
              disabled={running || busy || status === null}
              onClick={() => setConfirming(true)}
            >
              {running ? "Fut…" : "Futtatás most"}
            </PilotButton>
          ) : undefined
        }
      />
      <SettlementTabs />
      <FeedBackfillPanel token={token} canRun={canRun} />
      {notice ? (
        <Alert variant="info" title="Indítás" description={notice} />
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {running && status?.startedAt ? (
        <p className="text-sm text-pilot-grey-700" role="status">
          Fut ({formatDateTimeHu(status.startedAt)} óta)…
        </p>
      ) : null}
      {status === null || runs === null ? (
        <Skeleton className="h-32" />
      ) : status.sources.length === 0 ? (
        <EmptyState
          title="Nincs forrás"
          description="A szerver nem nevezett meg forrást."
        />
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          data-testid="paid-mark-sources"
        >
          {status.sources.map(({ source, mode }) => (
            <SourceRun
              key={source}
              source={source}
              mode={mode}
              run={latest.get(source)}
              canPull={canRun}
              token={token}
              onChanged={() => void load()}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirming}
        title="Elindítod a kifizetett-jelölést most?"
        consequence="Az automatikus állású források a jelölhető számlákat beírják a Számlázz.hu-ba; a próba állásúak csak tervet készítenek, semmit nem írnak."
        recovery="A beírt kifizetést csak a Számlázz.hu felületén lehet visszavonni. Egy számla akkor sem kap kétszer jelölést, ha a napi futás is lefut."
        confirmLabel="Futtatás most"
        busy={busy}
        onConfirm={() => void runNow()}
        onCancel={() => setConfirming(false)}
      />
    </PilotThemeRoot>
  );
}
