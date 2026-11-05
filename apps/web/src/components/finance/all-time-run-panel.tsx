"use client";

import { Alert, ConfirmDialog } from "@acropora/ui";
import { formatMoney } from "@acropora/types";
import { useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import {
  paidMarksApi,
  type AllTimePreview,
  type PaidMarkSource,
} from "@/lib/api/paid-marks";

export const PAID_MARK_SOURCE_LABEL: Record<PaidMarkSource, string> = {
  GLS_COD: "GLS utánvét",
  FOXPOST: "Foxpost utánvét",
  SIMPLEPAY: "SimplePay kártyás fizetés",
  BANK_TRANSFER: "Banki átutalás",
};

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

/** Amit az író kihagyna, okonként, a lap szavaival (acrobot 43886: a szám az, amit az író tényleg megkísérel). */
const SKIP_TEXT: Record<string, string> = {
  LOGGED_BEFORE: "már beírva",
  ALREADY_PAID: "a feed szerint fizetve",
  NOT_UNPAID: "nem bizonyíthatóan fizetetlen",
  UNCERTAIN_BEFORE: "bizonytalan korábbi hívás",
};
const skippedText = (skipped: Record<string, number>) =>
  Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${SKIP_TEXT[kind] ?? kind} ${n}`)
    .join(", ");

const total = (planned: AllTimePreview["planned"]) =>
  planned.reduce((sum, mark) => sum + Number(mark.amount), 0);

/**
 * A RÉGI JÓVÁÍRÁSOK PÁROSÍTÁSA: A KIFIZETETT-JELÖLÉS KORHATÁR NÉLKÜL (acrobot 43776, 43822: "Ne menjen vakon"). A feed
 * visszatöltése után egy ilyen futás az automatikus forrásokon egyszerre jelölhet kifizetettre minden régi számlát, amit
 * az új feed-sorok párosíthatóvá tesznek. Ezért két lépés: az ELŐNÉZET forrásonként megmutatja, mit jelölne (darab,
 * összeg, sorok), és semmit nem ír; a BEÍRÁS csak utána, külön gombbal és megerősítéssel indul. A próba állású forrás a
 * beíráskor is csak tervez.
 */
export function AllTimeRunPanel({
  token,
  onStarted,
}: {
  token: string;
  /** a futás elindult: a lap újraolvassa a futásokat (és figyeli, mikor ér véget) */
  onStarted: () => void;
}) {
  const [preview, setPreview] = useState<AllTimePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const look = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setPreview(await paidMarksApi.allTimePreview(token));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await paidMarksApi.runNow(token, { allTime: true });
      setConfirming(false);
      setPreview(null);
      setNotice(
        answer.status === "started"
          ? "A korhatár nélküli futás elindult. A források legutóbbi futása mutatja, mi lett."
          : answer.status === "running"
            ? "Egy futás már tart: a korhatár nélküli NEM indult el. Ha véget ért, nézd meg újra az előnézetet."
            : "Egyik forrás sincs automatikus vagy próba állásban, nem futott semmi.",
      );
      if (answer.status === "started") onStarted();
    } catch (cause) {
      setConfirming(false);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const writing = (preview ?? []).filter((p) => p.mode === "auto");
  const toWrite = writing.reduce((sum, p) => sum + p.planned.length, 0);

  return (
    <section
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid="all-time-run"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          Régi jóváírások párosítása (korhatár nélkül)
        </span>
        <span className="inline-flex flex-wrap gap-2">
          <PilotButton
            variant="secondary"
            disabled={busy}
            onClick={() => void look()}
          >
            Előnézet korhatár nélkül
          </PilotButton>
          <PilotButton
            disabled={busy || preview === null}
            onClick={() => setConfirming(true)}
          >
            Beírás korhatár nélkül
          </PilotButton>
        </span>
      </div>
      <p className="text-xs text-pilot-grey-600">
        A napi futás csak az utolsó napokat nézi. Ez egyszer minden tárolt
        jóváírást és elszámolást megnéz, ugyanazzal a döntéssel. Előbb az
        előnézet: az nem ír semmit.
      </p>
      {preview ? (
        <ul className="space-y-3" data-testid="all-time-preview">
          {preview.map((p) => (
            <li
              key={p.source}
              className="space-y-1"
              data-testid={`all-time-preview-${p.source}`}
            >
              <p className="text-sm">
                <span className="font-medium">
                  {PAID_MARK_SOURCE_LABEL[p.source]}
                </span>
                {": "}
                {p.errorCode
                  ? `az előnézet nem sikerült (${p.errorCode})`
                  : `${p.mode === "auto" ? "kifizetettre jelölne" : "próba: csak tervezné"} ${p.planned.length} számlát (${formatMoney(String(total(p.planned)), "HUF")}); figyelmet kérne ${p.attentionCount}${skippedText(p.skipped) ? `; kimarad: ${skippedText(p.skipped)}` : ""}`}
              </p>
              {p.planned.length > 0 ? (
                <ul className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 text-xs">
                  {p.planned.map((mark) => (
                    <li
                      key={`${mark.invoiceNumber}-${mark.sourceRef}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1"
                    >
                      <span className="font-medium">{mark.invoiceNumber}</span>
                      <span>{formatMoney(mark.amount, "HUF")}</span>
                      <span className="w-full text-pilot-grey-600 sm:w-auto">
                        {mark.date} · {mark.sourceRef}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <Alert variant="info" title="Korhatár nélkül" description={notice} />
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Elindítod a kifizetett-jelölést korhatár nélkül?"
        consequence={
          toWrite > 0
            ? `Az automatikus források ${toWrite} számlát jelölnek kifizetettre a Számlázz.hu-ban (${writing
                .filter((p) => p.planned.length > 0)
                .map(
                  (p) =>
                    `${PAID_MARK_SOURCE_LABEL[p.source]}: ${p.planned.length}`,
                )
                .join(
                  ", ",
                )}), ahogy az előnézet mutatta; a próba állásúak csak tervet készítenek.`
            : "Az előnézet szerint egy automatikus forrás sem jelölne most kifizetettre; a próba állásúak csak tervet készítenek."
        }
        recovery="A beírt kifizetést csak a Számlázz.hu felületén lehet visszavonni. Egy számla akkor sem kap kétszer jelölést, ha a napi futás is lefut."
        confirmLabel="Beírás"
        busy={busy}
        onConfirm={() => void write()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
