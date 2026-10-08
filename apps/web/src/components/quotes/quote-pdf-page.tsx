"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type QuoteDetailDto,
} from "@acropora/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";

import { errorText, isAbort, QUOTE_VERSION_STATUS } from "./quote-format";
import { QUOTES_PATH } from "./quote-list-page";

/**
 * A PDF-ELŐNÉZET ÉS A PUBLIKÁLÁS (#1582 P2; Figma 35 · OS / Offers / PDF
 * Preview, 569:363). Piszkozatnál a szerver élőben rajzolja (nem tárolja);
 * publikált verziónál a tárolt bájtokat adja, újrarajzolás nélkül. A
 * publikálás zárolja a verziót, ezért megerősítést kér. A terv oldalsáv-
 * bélyegképei helyett a böngésző saját PDF-nézője lapoz.
 */
export function QuotePdfPage({ quoteId }: { quoteId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_VIEW),
  );
  const canPublish = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_PUBLISH),
  );
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const requested = search.get("v");
  const version = quote
    ? (quote.versions.find((v) => v.id === requested) ??
      quote.versions.find((v) => v.status === "DRAFT") ??
      quote.versions.at(-1) ??
      null)
    : null;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
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

  const versionId = version?.id ?? null;
  const versionStatus = version?.status ?? null;
  useEffect(() => {
    if (!versionId) return;
    let live = true;
    let objectUrl: string | null = null;
    setUrl(null);
    quotesApi
      .pdf(token, quoteId, versionId)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (live) setError(errorText(cause, "A PDF nem tölthető be."));
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [quoteId, token, versionId, versionStatus]);

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
  if (!quote || !version) return <Skeleton className="h-64 w-full" />;

  const draft = version.status === "DRAFT";
  const fileName = `${quote.quoteNumber}-v${version.versionNumber}${draft ? "-elonezet" : ""}.pdf`;

  const publish = async () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      setQuote(await quotesApi.publish(token, quote.id, version.id));
    } catch (cause) {
      setError(errorText(cause, "A publikálás nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Pénzügy / Árajánlatok"
        title={`PDF előnézet · ${quote.quoteNumber} v${version.versionNumber}`}
        description="Pontosan azt mutatja, amit az ügyfél kap. A publikált PDF a verzióhoz rögzül."
        meta={
          <PilotBadge variant={QUOTE_VERSION_STATUS[version.status].variant}>
            {draft
              ? "Piszkozat · még nincs publikálva"
              : QUOTE_VERSION_STATUS[version.status].label}
          </PilotBadge>
        }
        actions={
          <div className="flex flex-wrap gap-3">
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() =>
                router.push(
                  draft
                    ? `${QUOTES_PATH}/${quote.id}/szerkesztes`
                    : `${QUOTES_PATH}/${quote.id}`,
                )
              }
            >
              {draft ? "Vissza a szerkesztőhöz" : "Vissza az adatlapra"}
            </PilotButton>
            {url ? (
              <a
                href={url}
                download={fileName}
                className="inline-flex items-center rounded-lg border border-pilot-grey-200 bg-white px-4 py-2 text-sm font-semibold"
              >
                PDF letöltése
              </a>
            ) : null}
            {draft && canPublish ? (
              <PilotButton
                size="regular"
                disabled={busy}
                onClick={() => setAsking(true)}
              >
                Verzió publikálása
              </PilotButton>
            ) : null}
          </div>
        }
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {url ? (
        <iframe
          title={`${quote.quoteNumber} v${version.versionNumber} PDF`}
          src={url}
          className="h-[80vh] w-full rounded-lg border border-pilot-grey-200 bg-white"
        />
      ) : (
        <Skeleton className="h-[60vh] w-full" />
      )}

      <ConfirmDialog
        open={asking}
        title={`v${version.versionNumber} publikálása`}
        consequence="A verzió zárolódik, a PDF-je rögzül a dokumentumtárban, és az előző publikált verzió felülírtnak számít. Ez még nem küld semmit az ügyfélnek."
        recovery="Publikált verzió nem szerkeszthető; módosításhoz új verziót kell nyitni az adatlapon."
        confirmLabel="Publikálás"
        busy={busy}
        onConfirm={() => void publish()}
        onCancel={() => setAsking(false)}
      />
    </PilotThemeRoot>
  );
}
