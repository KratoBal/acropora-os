"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  type BankTransferCreditView,
  type BankTransferDecisionView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { bankTransfersApi } from "@/lib/api/bank-transfers";

import { SettlementTabs } from "./settlement-tabs";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

/** Where a credit stands, in one badge and an optional line. */
function CreditState({ credit }: { credit: BankTransferCreditView }) {
  if (credit.written.length > 0)
    return (
      <PilotBadge variant="success">{`Beírva: ${credit.written.join(", ")}`}</PilotBadge>
    );
  if (credit.decision.markable)
    return <PilotBadge variant="teal">Egyezik: a napi futás beírja</PilotBadge>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <PilotBadge variant="amber">Kézi párosítás kell</PilotBadge>
      <span className="text-xs text-pilot-grey-600">
        {credit.decision.reason}
        {credit.decision.detail ? ` (${credit.decision.detail})` : ""}
      </span>
    </span>
  );
}

function DecisionLines({ decision }: { decision: BankTransferDecisionView }) {
  if (!decision.markable)
    return (
      <Alert
        variant="danger"
        title="Nem írható be"
        description={`${decision.reason}${decision.detail ? ` (${decision.detail})` : ""}`}
      />
    );
  return (
    <div className="space-y-1 text-sm" data-testid="bank-transfer-marks">
      {decision.marks.map((mark) => (
        <div key={mark.invoiceNumber}>
          {mark.invoiceNumber}: {formatMoney(mark.amount, "HUF")}
        </div>
      ))}
      {decision.paidBefore.length > 0 ? (
        <div className="text-xs text-pilot-grey-600">
          Már kifizetve ebből az utalásból (a Számlázz.hu párosította), nem írom
          újra: {decision.paidBefore.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

/** One credit's manual pairing: type the invoice numbers, check, close. */
function PairingPanel({
  token,
  credit,
  onPaired,
}: {
  token: string;
  credit: BankTransferCreditView;
  onPaired: (message: string) => void;
}) {
  const [text, setText] = useState(credit.narrative);
  const [checked, setChecked] = useState<{
    text: string;
    decision: BankTransferDecisionView;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setChecked({
        text,
        decision: await bankTransfersApi.check(token, credit.id, text),
      });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bankTransfersApi.pair(token, credit.id, text);
      const written = result.lines
        .filter((line) => line.outcome === "WRITTEN")
        .map((line) => line.invoiceNumber);
      const other = result.lines.filter((line) => line.outcome !== "WRITTEN");
      onPaired(
        [
          written.length > 0 ? `Beírva: ${written.join(", ")}.` : "",
          other.length > 0
            ? `Nem írtam be: ${other.map((l) => `${l.invoiceNumber} (${l.outcome})`).join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  // the write is offered only for the text just checked, and only on a match
  const ready = checked?.text === text && checked.decision.markable;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-pilot-grey-200 p-4">
      <label
        className="block text-sm font-medium"
        htmlFor={`invoices-${credit.id}`}
      >
        Számlaszámok (pl. 2026/00083,86,85,84 vagy 2026/00083-86)
      </label>
      <input
        id={`invoices-${credit.id}`}
        className="w-full rounded-lg border border-pilot-grey-300 px-3 py-2 text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <PilotButton
          variant="secondary"
          disabled={busy || text.trim() === ""}
          onClick={() => void check()}
        >
          Ellenőrzés
        </PilotButton>
        <PilotButton
          disabled={busy || !ready}
          onClick={() => setConfirming(true)}
        >
          Beírás a Számlázz.hu-ba
        </PilotButton>
      </div>
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {checked && checked.text === text ? (
        <DecisionLines decision={checked.decision} />
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Beírod a kifizetést a Számlázz.hu-ba?"
        consequence={`A jóváírás (${formatMoney(credit.amount, credit.currency)}) kifizetésként kerül a fenti számlákra.`}
        recovery="A beírt kifizetést csak a Számlázz.hu felületén lehet visszavonni."
        confirmLabel="Lezárom"
        busy={busy}
        onConfirm={() => void pair()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/**
 * BANKI ÁTUTALÁSOK (kártya aeddb2c3; Balázs 2026-11-04 16:36 UTC: egy utalás négy számlára, „2026/00083,86,85,84”).
 * A jóváírások, amelyek saját számlát neveznek meg: ami egy vevőé és fillérre egyezik, azt a napi futás magától
 * beírja; a többit itt párosítja egy ember, a számlaszámok beírásával. Mindent a szerver dönt el újra.
 */
export function BankTransfersPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canIssue = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_ISSUE),
  );
  const [all, setAll] = useState(false);
  const [credits, setCredits] = useState<BankTransferCreditView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setError(null);
    try {
      setCredits(await bankTransfersApi.list(token, { all }));
    } catch (cause) {
      setError(errorText(cause));
      setCredits([]);
    }
  }, [token, canView, all]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a banki átutalásokhoz"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description="Banki jóváírások, amelyek egy vagy több saját számlát fizetnek. Ami egy vevőé és fillérre egyezik, azt a napi futás magától beírja; a többit itt párosíthatod."
      />
      <SettlementTabs />
      {notice ? (
        <Alert variant="info" title="Kész" description={notice} />
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={all}
          onChange={(event) => setAll(event.target.checked)}
        />
        Minden jóváírás (azok is, amelyek közleménye nem nevez meg saját
        számlát)
      </label>
      {credits === null ? (
        <Skeleton className="h-32" />
      ) : credits.length === 0 ? (
        <EmptyState
          title="Nincs párosítandó jóváírás"
          description="Az elmúlt 60 napban nincs saját számlát megnevező jóváírás."
        />
      ) : (
        <ul className="space-y-3" data-testid="bank-transfers">
          {credits.map((credit) => (
            <li
              key={credit.id}
              className="rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">
                    {credit.day} · {formatMoney(credit.amount, credit.currency)}
                    {credit.counterpartyName
                      ? ` · ${credit.counterpartyName}`
                      : ""}
                  </div>
                  <div className="text-xs text-pilot-grey-600">
                    Közlemény: {credit.narrative || "—"}
                  </div>
                  <CreditState credit={credit} />
                </div>
                {canIssue && credit.written.length === 0 ? (
                  <PilotButton
                    variant="secondary"
                    onClick={() =>
                      setOpen((current) =>
                        current === credit.id ? null : credit.id,
                      )
                    }
                  >
                    Párosítás
                  </PilotButton>
                ) : null}
              </div>
              {open === credit.id ? (
                <PairingPanel
                  token={token}
                  credit={credit}
                  onPaired={(message) => {
                    setNotice(message);
                    setOpen(null);
                    void load();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PilotThemeRoot>
  );
}
