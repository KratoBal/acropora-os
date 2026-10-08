"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type QuoteDetailDto,
  type QuoteInternalVersion,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";

import {
  errorText,
  formatQuoteDay,
  formatQuoteMoney,
  isAbort,
  QUOTE_STATUS,
  QUOTE_VERSION_STATUS,
} from "./quote-format";
import { QUOTES_PATH } from "./quote-list-page";
import {
  QuoteOutcomeCard,
  QuoteOutcomeDrawer,
  type QuoteOutcomeAction,
} from "./quote-outcome";
import { QuoteHandoffCard, QuoteHandoffDrawer } from "./quote-handoff";
import { QuoteMilestonesCard } from "./quote-proforma";
import { QuoteAcceptanceLinkCard } from "./quote-link";
import { QuoteDeliveryLog, QuoteSendDrawer } from "./quote-send";

/** A legújabb verzió (a verziók számuk szerint növekvő sorrendben jönnek). */
export function latestVersion(
  quote: QuoteDetailDto,
): QuoteInternalVersion | null {
  return quote.versions.at(-1) ?? null;
}

/**
 * EGY ÁRAJÁNLAT (#1582 P1; Figma 35 · OS / Offers / Detail, 569:504). A fej,
 * az összegek és a verziók; a szerkesztés és az új verzió innen indul. Az
 * ügyfélaktivitás, a workflow-idővonal, a „Következő javasolt lépés” és a
 * kiküldés a későbbi fázisoké (P2-P4): adat nélkül nem rajzoljuk ki.
 */
export function QuoteDetailPage({ quoteId }: { quoteId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_MANAGE),
  );
  const canRecord = Boolean(
    session &&
    hasPermission(session.user, PERMISSIONS.QUOTES_ACCEPTANCE_RECORD),
  );
  const canSend = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_SEND),
  );
  const canLink = Boolean(
    session &&
    hasPermission(session.user, PERMISSIONS.QUOTES_ACCEPTANCE_LINK_MANAGE),
  );
  const canHandoff = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_HANDOFF),
  );
  const [outcome, setOutcome] = useState<QuoteOutcomeAction | null>(null);
  const canBilling = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_CREATE),
  );
  const [handingOff, setHandingOff] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setQuote(await quotesApi.detail(token, quoteId, signal));
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "Az ajánlat nem tölthető be."));
      }
    },
    [canView, quoteId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az árajánlatokhoz"
        description="quotes.view jogosultság szükséges."
      />
    );
  if (error && !quote)
    return <Alert variant="danger" title="Hiba történt" description={error} />;
  if (!quote) return <Skeleton className="h-64 w-full" />;

  const latest = latestVersion(quote);
  const hasDraft = quote.versions.some((v) => v.status === "DRAFT");
  const editable = ["DRAFT", "SENT", "POSTPONED"].includes(quote.status);
  const hasPublished = quote.versions.some((v) => v.status === "PUBLISHED");
  // P3: the version the customer gets is the one PUBLISHED now
  const sendable = quote.versions.find((v) => v.status === "PUBLISHED") ?? null;
  const canMail =
    canSend &&
    sendable !== null &&
    ["DRAFT", "SENT", "POSTPONED", "ACCEPTED"].includes(quote.status);

  const newVersion = async () => {
    setBusy(true);
    setError(null);
    try {
      await quotesApi.newVersion(token, quote.id);
      router.push(`${QUOTES_PATH}/${quote.id}/szerkesztes`);
    } catch (cause) {
      setError(errorText(cause, "Az új verzió nem nyitható meg."));
      setBusy(false);
    }
  };

  const columns: PilotTableColumn<QuoteInternalVersion>[] = [
    {
      id: "v",
      header: "Verzió",
      width: "15%",
      cell: (v) => `v${v.versionNumber}`,
    },
    {
      id: "status",
      header: "Állapot",
      width: "20%",
      cell: (v) => (
        <PilotBadge variant={QUOTE_VERSION_STATUS[v.status].variant}>
          {QUOTE_VERSION_STATUS[v.status].label}
        </PilotBadge>
      ),
    },
    {
      id: "total",
      header: "Összeg",
      width: "25%",
      cell: (v) => (
        <span className="font-semibold">
          {formatQuoteMoney(v.netTotal, v.currency)}
        </span>
      ),
    },
    {
      id: "valid",
      header: "Érvényes",
      width: "16%",
      cell: (v) => formatQuoteDay(v.validUntil),
    },
    {
      id: "published",
      header: "Publikálva",
      width: "16%",
      cell: (v) => formatQuoteDay(v.publishedAt),
    },
    {
      id: "pdf",
      header: "PDF",
      width: "12%",
      cell: (v) => (
        <PilotButton
          variant="ghost"
          aria-label={`v${v.versionNumber} PDF`}
          onClick={() =>
            router.push(`${QUOTES_PATH}/${quote.id}/pdf?v=${v.id}`)
          }
        >
          {v.status === "DRAFT" ? "Előnézet" : "PDF"}
        </PilotButton>
      ),
    },
  ];

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Pénzügy / Árajánlatok"
        title={`${quote.quoteNumber} · ${quote.customerName ?? quote.title}`}
        description={quote.title}
        meta={
          <div className="flex flex-wrap items-center gap-3 text-xs text-pilot-grey-600">
            <PilotBadge variant={QUOTE_STATUS[quote.status].variant}>
              {QUOTE_STATUS[quote.status].label}
            </PilotBadge>
            {latest ? (
              <span>
                Aktuális verzió: v{latest.versionNumber} · érvényes{" "}
                {formatQuoteDay(latest.validUntil)}
              </span>
            ) : null}
          </div>
        }
        actions={
          (editable && (canManage || canRecord)) || canMail ? (
            <div className="flex flex-wrap gap-2">
              {canMail ? (
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={() => setSending(true)}
                >
                  {quote.deliveries.some(
                    (d) =>
                      d.versionId === sendable?.id && d.outcome !== "FAILED",
                  )
                    ? "Újraküldés"
                    : "Kiküldés"}
                </PilotButton>
              ) : null}
              {editable && canManage ? (
                <>
                  <PilotButton
                    variant="ghost"
                    onClick={() => setOutcome("reject")}
                  >
                    Elutasítás
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    onClick={() => setOutcome("postpone")}
                  >
                    Halasztás
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    onClick={() => setOutcome("cancel")}
                  >
                    Visszavonás
                  </PilotButton>
                </>
              ) : null}
              {editable && canRecord && hasPublished ? (
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={() => setOutcome("accept")}
                >
                  Elfogadás rögzítése
                </PilotButton>
              ) : null}
              {editable && canManage ? (
                hasDraft ? (
                  <PilotButton
                    size="regular"
                    onClick={() =>
                      router.push(`${QUOTES_PATH}/${quote.id}/szerkesztes`)
                    }
                  >
                    Szerkesztés
                  </PilotButton>
                ) : (
                  <PilotButton
                    size="regular"
                    disabled={busy}
                    onClick={() => void newVersion()}
                  >
                    Új verzió
                  </PilotButton>
                )
              ) : null}
            </div>
          ) : undefined
        }
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <PilotCard>
        <div className="grid gap-5 p-5 sm:grid-cols-3">
          <Fact label="Partner" value={quote.customerName ?? "—"} />
          <Fact
            label="Ajánlat összege (nettó)"
            value={
              latest ? formatQuoteMoney(latest.netTotal, latest.currency) : "—"
            }
          />
          <Fact
            label="Opciók"
            value={
              latest
                ? `+${formatQuoteMoney(latest.optionalNetTotal, latest.currency)}`
                : "—"
            }
          />
          <Fact label="Készítő" value={quote.createdByName ?? "—"} />
          <Fact label="Felelős" value={quote.ownerName ?? "—"} />
          <Fact
            label="Érvényesség"
            value={latest ? formatQuoteDay(latest.validUntil) : "—"}
          />
        </div>
      </PilotCard>

      <QuoteDeliveryLog quote={quote} />

      <QuoteAcceptanceLinkCard
        token={token}
        quote={quote}
        canManage={canLink}
      />

      <QuoteHandoffCard
        quote={quote}
        canHandoff={canHandoff}
        onStart={() => setHandingOff(true)}
      />

      {notice ? <Alert title="Projekt elindítva" description={notice} /> : null}

      <QuoteMilestonesCard
        token={token}
        quote={quote}
        canPrepare={canHandoff && canBilling}
        onChanged={() => void load()}
      />

      <QuoteOutcomeCard
        quote={quote}
        canRecord={canRecord}
        onRevoke={() => setOutcome("revoke")}
      />

      <PilotCard>
        <PilotCardHeader title="Verziók" />
        <div className="space-y-3 p-5">
          <p className="text-xs text-pilot-grey-600">
            Minden publikált verzió zárolva marad; a módosítás új verziót nyit.
          </p>
          <PilotDataTable
            columns={columns}
            rows={[...quote.versions].reverse()}
            rowKey={(v) => v.id}
            minWidth={640}
          />
        </div>
      </PilotCard>

      <QuoteHandoffDrawer
        token={token}
        quote={quote}
        open={handingOff}
        canBilling={canBilling}
        onClose={() => setHandingOff(false)}
        onDone={(result) => {
          setHandingOff(false);
          setNotice(result.proforma?.skipped ?? null);
          void load();
        }}
      />

      <QuoteSendDrawer
        token={token}
        quote={quote}
        version={sendable}
        open={sending}
        onClose={() => setSending(false)}
        onDone={(next) => {
          setQuote(next);
          setSending(false);
        }}
      />

      <QuoteOutcomeDrawer
        token={token}
        quote={quote}
        action={outcome}
        onClose={() => setOutcome(null)}
        onDone={(next) => {
          setQuote(next);
          setOutcome(null);
        }}
      />
    </PilotThemeRoot>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-pilot-grey-600">{label}</p>
      <p className="mt-1 font-semibold text-pilot-grey-900">{value}</p>
    </div>
  );
}
