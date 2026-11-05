"use client";

import { Alert, ConfirmDialog } from "@acropora/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import {
  feedBackfillApi,
  type FeedBackfillStart,
  type FeedBackfillStatus,
} from "@/lib/api/feed-backfill";
import { formatDateTimeHu } from "@/lib/format/date";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

const count = (
  answers: Record<string, number> | undefined,
  ...keys: string[]
) => keys.reduce((sum, key) => sum + (answers?.[key] ?? 0), 0);

const startText = (answer: FeedBackfillStart) =>
  answer.status === "started"
    ? `Elindult: ${answer.total} szám. A lap magától frissül.`
    : answer.status === "running"
      ? "Egy kör már fut: megvárjuk."
      : answer.phase === "apply"
        ? "Nincs behúzható szám: előbb az ellenőrzés kell."
        : "Nincs megkérdezendő szám.";

/**
 * A TÁROLT SZÁMLÁZZ.HU FEED VISSZATÖLTÉSE AZ ÉV ELEJÉIG (6fd8c574; acrobot 43766, 43768, 43776). A feed csak a push
 * bekötése óta hoz számlát, a korábbiak a kifizetett-jelölésnek "nincs a Számlázz.hu feedben". Sorozatonként a hiány,
 * és amit a Számlázz.hu a számokra felelt: az ACRW sorozat külön sor, így látszik, a cmfx-ben kiállított számokat ismeri-e.
 * Két lépés: ellenőrzés (csak kérdez), utána behúzás (csak amit ismer). A régi jóváírások párosítása külön panel
 * (`AllTimeRunPanel`): előbb száraz előnézet, utána külön gomb (acrobot 43822).
 */
export function FeedBackfillPanel({
  token,
  canRun,
}: {
  token: string;
  /** a "Lekérés a Számlázz.hu-ból" joga (BILLING_ISSUE) */
  canRun: boolean;
}) {
  const [status, setStatus] = useState<FeedBackfillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"dry" | "apply" | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await feedBackfillApi.status(token);
      setStatus(next);
      setError(null);
      if (next.running) poll.current = setTimeout(() => void load(), 3000);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  const start = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setNotice(startText(await feedBackfillApi.start(token, apply)));
      setConfirm(null);
      await load();
    } catch (cause) {
      setConfirm(null);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!status)
    return error ? (
      <Alert
        variant="danger"
        title="A visszatöltés állapota"
        description={error}
      />
    ) : null;
  const missing = status.series.reduce((sum, s) => sum + s.missing, 0);
  const known = Object.values(status.checked).reduce(
    (sum, answers) => sum + count(answers, "WOULD_STORE"),
    0,
  );
  const series = [
    ...new Set([
      ...status.series.map((s) => s.series),
      ...Object.keys(status.checked),
    ]),
  ];
  if (series.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid="feed-backfill"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          A Számlázz.hu feed visszatöltése {status.year} elejéig
        </span>
        {canRun ? (
          <span className="inline-flex flex-wrap gap-2">
            <PilotButton
              variant="secondary"
              disabled={busy || status.running !== null || missing === 0}
              onClick={() => setConfirm("dry")}
            >
              Ellenőrzés a Számlázz.hu-nál
            </PilotButton>
            <PilotButton
              disabled={busy || status.running !== null || known === 0}
              onClick={() => setConfirm("apply")}
            >
              Behúzás ({known} számla)
            </PilotButton>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-pilot-grey-600">
        A feed csak a bekötése óta hoz számlát. A Számlázz.hu egyszerre egy
        számot ad ki, ezért a kör számonként kérdez, lassítva.
      </p>
      <ul className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 text-sm">
        {series.map((name) => {
          const gap = status.series.find((s) => s.series === name);
          const answers = status.checked[name];
          return (
            <li
              key={name}
              className="space-y-1 px-4 py-2"
              data-testid={`feed-backfill-series-${name}`}
            >
              <span className="font-medium">{name}</span>
              <span className="block text-xs text-pilot-grey-700">
                A feedből hiányzik: {gap?.missing ?? 0}
                {gap ? ` (legnagyobb tárolt: ${gap.highest})` : ""} · a
                Számlázz.hu ismeri: {count(answers, "WOULD_STORE")} · behúzva:{" "}
                {count(answers, "STORED")} · nem ismeri:{" "}
                {count(answers, "NOT_FOUND")} · hiba:{" "}
                {count(answers, "ERROR", "UNREADABLE", "OTHER_NUMBER")}
              </span>
            </li>
          );
        })}
      </ul>
      {status.running ? (
        <p className="text-sm text-pilot-grey-700" role="status">
          Fut ({status.running.phase === "apply" ? "behúzás" : "ellenőrzés"}):{" "}
          {status.running.done} / {status.running.total}
        </p>
      ) : status.last ? (
        <p
          className="text-xs text-pilot-grey-600"
          data-testid="feed-backfill-last"
        >
          Utolsó kör ({status.last.phase === "apply" ? "behúzás" : "ellenőrzés"}
          ): {formatDateTimeHu(status.last.finishedAt)}, {status.last.done} szám
        </p>
      ) : null}
      {notice ? (
        <Alert variant="info" title="Visszatöltés" description={notice} />
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      <ConfirmDialog
        open={confirm === "dry"}
        title="Megkérdezed a Számlázz.hu-t a feedből hiányzó számokról?"
        consequence={`Legfeljebb ${missing} lekérdezés, számonként, lassítva. A Számlázz.hu-n csak olvas, a feedbe nem ír; a lap sorozatonként mutatja, mit ismer.`}
        recovery="A választ adó számot a következő kör nem kérdezi újra; a hibásat igen."
        confirmLabel="Ellenőrzés"
        busy={busy}
        onConfirm={() => void start(false)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "apply"}
        title={`Behúzod a ${known} számlát a Számlázz.hu-ból?`}
        consequence="A számlák a feed részei lesznek. A régi jóváírások párosítása nem indul magától: utána a korhatár nélküli előnézet mutatja, mit jelölne. A Számlázz.hu-ban nem változik semmi."
        recovery="Ugyanaz a számla másodszor nem kerül be; a beírt kifizetést csak a Számlázz.hu felületén lehet visszavonni."
        confirmLabel="Behúzás"
        busy={busy}
        onConfirm={() => void start(true)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
