"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDrawer,
  PilotFormField,
  PilotInput,
  Skeleton,
} from "@acropora/ui";
import type {
  QuoteDetailDto,
  QuoteInternalVersion,
  QuoteSendDraftDto,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText } from "./quote-format";

const OUTCOME = {
  SENT: { label: "Kiment", variant: "success" },
  FAILED: { label: "Nem ment ki", variant: "danger" },
  INDETERMINATE: { label: "Bizonytalan", variant: "amber" },
} as const;

const BODY_CLASS =
  "min-h-48 w-full rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500";

/** Addresses typed with commas, semicolons or spaces, as a list. */
const addresses = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

/** `2026-10-08T07:12:00Z` → `2026.10.08. 09:12` (Budapest) */
function when(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}.${get("month")}.${get("day")}. ${get("hour")}:${get("minute")}`;
}

/**
 * A KIKÜLDÉSEK NAPLÓJA (#1582 P3): minden kísérlet egy sor, a legújabb elöl.
 * Elfogadás nélküli, még ki nem küldött ajánlatnál nincs mit mutatni.
 */
export function QuoteDeliveryLog({ quote }: { quote: QuoteDetailDto }) {
  if (!quote.deliveries.length) return null;
  return (
    <PilotCard>
      <PilotCardHeader title="Kiküldések" />
      <ul className="divide-y divide-pilot-grey-100">
        {quote.deliveries.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm"
          >
            <PilotBadge variant={OUTCOME[d.outcome].variant}>
              {OUTCOME[d.outcome].label}
            </PilotBadge>
            <span className="font-medium text-pilot-grey-900">
              v{d.versionNumber}
              {d.isResend ? " · újraküldés" : ""}
            </span>
            <span className="text-pilot-grey-700">{d.to.join(", ")}</span>
            {d.redirectedTo ? (
              <span className="text-xs text-pilot-amber-700">
                próbacímre irányítva: {d.redirectedTo}
              </span>
            ) : null}
            <span className="text-xs text-pilot-grey-500">
              {when(d.createdAt)}
              {d.initiatedByName ? ` · ${d.initiatedByName}` : ""}
            </span>
            {d.error ? (
              <span className="w-full text-xs text-pilot-red-700">
                {d.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </PilotCard>
  );
}

/**
 * A KIKÜLDŐ FIÓK (#1582 P3). A Levelezés oldal „Árajánlat kiküldése”
 * sablonjával nyílik, a változók már kitöltve; címzett, tárgy és szöveg
 * küldés előtt átírható. A PDF a publikáláskor tárolt fájl, csatolmányként.
 * Ha a verzió már kiment, a gomb újraküldést indít (külön végpont), így egy
 * eltévedt kattintás nem küld kétszer.
 */
export function QuoteSendDrawer({
  token,
  quote,
  version,
  open,
  onClose,
  onDone,
}: {
  token: string;
  quote: QuoteDetailDto;
  version: QuoteInternalVersion | null;
  open: boolean;
  onClose: () => void;
  onDone: (quote: QuoteDetailDto) => void;
}) {
  const [draft, setDraft] = useState<QuoteSendDraftDto | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // one id per opening: a double click sends one mail
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !version) return;
    let live = true;
    setDraft(null);
    setError(null);
    setBusy(false);
    setRequestId(crypto.randomUUID());
    quotesApi
      .sendDraft(token, quote.id, version.id)
      .then((next) => {
        if (!live) return;
        setDraft(next);
        setTo(next.to.join(", "));
        setCc("");
        setSubject(next.subject);
        setBody(next.body);
      })
      .catch((cause) => {
        if (live)
          setError(errorText(cause, "A levél vázlata nem tölthető be."));
      });
    return () => {
      live = false;
    };
  }, [open, version, quote.id, token]);

  const ready = Boolean(
    draft && addresses(to).length && subject.trim() && body.trim(),
  );

  const submit = async () => {
    if (!version || !draft || !ready) return;
    setBusy(true);
    setError(null);
    const input = {
      requestId,
      to: addresses(to),
      cc: addresses(cc),
      subject: subject.trim(),
      body,
    };
    try {
      onDone(
        draft.alreadySent
          ? await quotesApi.resend(token, quote.id, version.id, input)
          : await quotesApi.send(token, quote.id, version.id, input),
      );
    } catch (cause) {
      setError(errorText(cause, "A kiküldés nem sikerült."));
      setBusy(false);
    }
  };

  const title = draft?.alreadySent ? "Újraküldés" : "Kiküldés";
  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      width="lg"
      title={version ? `${title}: v${version.versionNumber}` : title}
      subtitle={`${quote.quoteNumber} · ${quote.title}`}
      footer={
        <div className="flex justify-end gap-2">
          <PilotButton variant="ghost" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={!ready || busy} onClick={() => void submit()}>
            {draft?.alreadySent ? "Újraküldöm" : "Elküldöm"}
          </PilotButton>
        </div>
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        {!draft && !error ? <Skeleton className="h-64 w-full" /> : null}
        {draft ? (
          <>
            {draft.alreadySent ? (
              <Alert
                variant="info"
                title="Ez a verzió már kiment"
                description="Az újraküldés ugyanezt a PDF-et küldi el még egyszer."
              />
            ) : null}
            <PilotFormField
              label="Címzett"
              required
              help="Több címet vesszővel válassz el."
            >
              <PilotInput aria-label="Címzett" value={to} onChange={setTo} />
            </PilotFormField>
            <PilotFormField label="Másolat">
              <PilotInput aria-label="Másolat" value={cc} onChange={setCc} />
            </PilotFormField>
            <PilotFormField label="Tárgy" required>
              <PilotInput
                aria-label="Tárgy"
                value={subject}
                onChange={setSubject}
              />
            </PilotFormField>
            <PilotFormField
              label="Levél"
              required
              help={
                draft.source === "stored"
                  ? "A Levelezés oldalon beállított szövegből."
                  : "Az alapszövegből; a Levelezés oldalon átírható."
              }
            >
              <textarea
                aria-label="Levél"
                className={BODY_CLASS}
                maxLength={10_000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </PilotFormField>
            <p className="text-xs text-pilot-grey-600">
              Csatolmány: {draft.fileName} (a publikáláskor tárolt PDF)
            </p>
          </>
        ) : null}
      </div>
    </PilotDrawer>
  );
}
