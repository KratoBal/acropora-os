"use client";

import {
  Alert,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotDrawer,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "@acropora/ui";
import type {
  QuoteAcceptanceDto,
  QuoteAcceptanceSourceValue,
  QuoteCloseReasonValue,
  QuoteDetailDto,
} from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import {
  dayAfter,
  errorText,
  formatQuoteDay,
  formatQuoteMoney,
  QUOTE_ACCEPTANCE_SOURCE,
  QUOTE_CLOSE_REASON,
} from "./quote-format";

/** What the outcome drawer does; null: closed. */
export type QuoteOutcomeAction =
  "accept" | "reject" | "postpone" | "cancel" | "revoke";

const TITLES: Record<QuoteOutcomeAction, string> = {
  accept: "Elfogadás rögzítése",
  reject: "Elutasítás",
  postpone: "Halasztás",
  cancel: "Az ajánlat visszavonása",
  revoke: "Az elfogadás visszavonása",
};

/** The submit button's own words, apart from the header buttons'. */
const SUBMITS: Record<QuoteOutcomeAction, string> = {
  accept: "Rögzítem",
  reject: "Elutasítom",
  postpone: "Elhalasztom",
  cancel: "Visszavonom",
  revoke: "Visszavonom az elfogadást",
};

const NOTE_CLASS =
  "min-h-20 w-full rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500";

/** The live acceptance, if any (the API sends them newest first). */
export function liveAcceptance(
  quote: QuoteDetailDto,
): QuoteAcceptanceDto | null {
  return quote.acceptances.find((a) => !a.revokedAt) ?? null;
}

/**
 * AZ AJÁNLAT KIMENETELE (#1582 P4a). Elfogadott ajánlatnál az elfogadás
 * adatai és a kért opciók; elutasítottnál, halasztottnál és visszavontnál az
 * ok, a dátum és a megjegyzés; a visszavont elfogadások előzményként. Nyitott,
 * elfogadás nélküli ajánlatnál nincs mit mutatni.
 */
export function QuoteOutcomeCard({
  quote,
  canRecord,
  onRevoke,
}: {
  quote: QuoteDetailDto;
  canRecord: boolean;
  onRevoke: () => void;
}) {
  const live = liveAcceptance(quote);
  const revoked = quote.acceptances.filter((a) => a.revokedAt);
  const closed = ["REJECTED", "POSTPONED", "CANCELLED"].includes(quote.status);
  if (!live && !closed && !revoked.length) return null;
  const optionalName = (versionId: string, itemId: string) =>
    quote.versions
      .find((v) => v.id === versionId)
      ?.blocks.flatMap((b) => b.items)
      .find((i) => i.id === itemId)?.name ?? "ismeretlen tétel";

  return (
    <PilotCard>
      <PilotCardHeader
        title="Kimenetel"
        action={
          live && canRecord ? (
            <PilotButton variant="ghost" onClick={onRevoke}>
              Elfogadás visszavonása
            </PilotButton>
          ) : undefined
        }
      />
      <div className="space-y-4 p-5">
        {live ? (
          <div>
            <PilotDataRow
              label="Elfogadva"
              value={`v${live.versionNumber} · ${formatQuoteDay(live.acceptedAt)} · ${QUOTE_ACCEPTANCE_SOURCE[live.source]}`}
            />
            <PilotDataRow
              label="Elfogadó"
              value={[live.acceptedByName, live.acceptedByEmail]
                .filter(Boolean)
                .join(" · ")}
            />
            <PilotDataRow
              label="Kért opciók"
              value={
                live.selectedOptionalItemIds.length
                  ? live.selectedOptionalItemIds
                      .map((id) => optionalName(live.versionId, id))
                      .join(", ")
                  : "Nem kért opciót"
              }
            />
            <PilotDataRow label="Megjegyzés" value={live.note ?? ""} />
            <PilotDataRow
              label="Rögzítette"
              value={live.recordedByName ?? ""}
            />
          </div>
        ) : null}
        {closed ? (
          <div>
            {quote.closeReason ? (
              <PilotDataRow
                label="Ok"
                value={QUOTE_CLOSE_REASON[quote.closeReason]}
              />
            ) : null}
            {quote.postponedUntil ? (
              <PilotDataRow
                label="Elhalasztva eddig"
                value={formatQuoteDay(quote.postponedUntil)}
              />
            ) : null}
            <PilotDataRow label="Megjegyzés" value={quote.closeNote ?? ""} />
          </div>
        ) : null}
        {revoked.length ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-pilot-grey-500">
              Visszavont elfogadások
            </p>
            <ul className="space-y-1 text-sm text-pilot-grey-700">
              {revoked.map((a) => (
                <li key={a.id}>
                  v{a.versionNumber} · {formatQuoteDay(a.acceptedAt)} ·
                  visszavonta {a.revokedByName ?? "ismeretlen"}{" "}
                  {formatQuoteDay(a.revokedAt)}: {a.revokeReason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </PilotCard>
  );
}

/**
 * A KIMENETEL LÉPÉSEI EGY FIÓKBAN: elfogadás rögzítése, elutasítás okkal,
 * halasztás dátumra, az ajánlat visszavonása, az elfogadás visszavonása. A
 * válasz a frissített ajánlat; hiba esetén a szerver magyar üzenete marad a
 * fiókban.
 */
export function QuoteOutcomeDrawer({
  token,
  quote,
  action,
  onClose,
  onDone,
}: {
  token: string;
  quote: QuoteDetailDto;
  action: QuoteOutcomeAction | null;
  onClose: () => void;
  onDone: (quote: QuoteDetailDto) => void;
}) {
  const published = useMemo(
    () => quote.versions.filter((v) => v.status === "PUBLISHED"),
    [quote.versions],
  );
  const today = dayAfter(0);
  const [versionId, setVersionId] = useState("");
  const [source, setSource] = useState<QuoteAcceptanceSourceValue>("PHONE");
  const [day, setDay] = useState(today);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [reason, setReason] = useState<QuoteCloseReasonValue | "">("");
  const [revokeReason, setRevokeReason] = useState("");
  const [note, setNote] = useState("");
  // one id per opening: a double click records one acceptance
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setVersionId(published.at(-1)?.id ?? "");
    setSource("PHONE");
    setDay(action === "postpone" ? dayAfter(30) : dayAfter(0));
    setName("");
    setEmail("");
    setOptions([]);
    setReason("");
    setRevokeReason("");
    setNote("");
    setRequestId(crypto.randomUUID());
    setError(null);
    setBusy(false);
  }, [action, published]);

  const version = published.find((v) => v.id === versionId) ?? null;
  const optionalItems =
    version?.blocks.flatMap((b) => b.items.filter((i) => i.isOptional)) ?? [];
  const expired = version ? version.validUntil.slice(0, 10) < today : false;
  const live = liveAcceptance(quote);

  const ready =
    action === "accept"
      ? Boolean(version && day && day <= today)
      : action === "reject"
        ? Boolean(reason)
        : action === "postpone"
          ? Boolean(day && day >= today)
          : action === "revoke"
            ? Boolean(revokeReason.trim() && live)
            : true;

  const submit = async () => {
    if (!action || !ready) return;
    setBusy(true);
    setError(null);
    const text = note.trim() || null;
    try {
      const next =
        action === "accept"
          ? await quotesApi.accept(token, quote.id, {
              versionId,
              source,
              acceptedAt: day,
              acceptedByName: name.trim() || null,
              acceptedByEmail: email.trim() || null,
              selectedOptionalItemIds: options,
              note: text,
              requestId,
            })
          : action === "reject"
            ? await quotesApi.reject(token, quote.id, {
                reason: reason as QuoteCloseReasonValue,
                note: text,
              })
            : action === "postpone"
              ? await quotesApi.postpone(token, quote.id, {
                  until: day,
                  note: text,
                })
              : action === "cancel"
                ? await quotesApi.cancel(token, quote.id, {
                    reason: reason || null,
                    note: text,
                  })
                : await quotesApi.revokeAcceptance(token, quote.id, live!.id, {
                    reason: revokeReason.trim(),
                  });
      onDone(next);
    } catch (cause) {
      setError(errorText(cause, "A lépés nem sikerült."));
      setBusy(false);
    }
  };

  const reasonSelect = (required: boolean) => (
    <PilotFormField label="Ok" required={required}>
      <PilotSelect
        aria-label="Ok"
        chevron
        value={reason}
        onChange={(value) => setReason(value as QuoteCloseReasonValue | "")}
      >
        <option value="">{required ? "Válassz okot" : "Nincs megadva"}</option>
        {(Object.keys(QUOTE_CLOSE_REASON) as QuoteCloseReasonValue[]).map(
          (key) => (
            <option key={key} value={key}>
              {QUOTE_CLOSE_REASON[key]}
            </option>
          ),
        )}
      </PilotSelect>
    </PilotFormField>
  );
  const noteField = (
    <PilotFormField label="Megjegyzés">
      <textarea
        aria-label="Megjegyzés"
        className={NOTE_CLASS}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </PilotFormField>
  );

  return (
    <PilotDrawer
      open={action !== null}
      onClose={onClose}
      title={action ? TITLES[action] : ""}
      subtitle={`${quote.quoteNumber} · ${quote.title}`}
      footer={
        <div className="flex justify-end gap-2">
          <PilotButton variant="ghost" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={!ready || busy} onClick={() => void submit()}>
            {action ? SUBMITS[action] : ""}
          </PilotButton>
        </div>
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}

        {action === "accept" ? (
          <>
            {published.length ? null : (
              <Alert
                variant="info"
                title="Nincs publikált verzió"
                description="Csak publikált verzió fogadható el."
              />
            )}
            <PilotFormField label="Verzió" required>
              <PilotSelect
                aria-label="Verzió"
                chevron
                value={versionId}
                onChange={(value) => {
                  setVersionId(value);
                  setOptions([]);
                }}
              >
                {published.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} ·{" "}
                    {formatQuoteMoney(v.netTotal, v.currency)}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
            {expired && version ? (
              <Alert
                variant="info"
                title="Az ajánlat érvényessége lejárt"
                description={`Érvényes volt eddig: ${formatQuoteDay(version.validUntil)}. Az elfogadás rögzíthető, de nézd át az árakat.`}
              />
            ) : null}
            <PilotFormField label="Hogyan fogadta el" required>
              <PilotSelect
                aria-label="Hogyan fogadta el"
                chevron
                value={source}
                onChange={(value) =>
                  setSource(value as QuoteAcceptanceSourceValue)
                }
              >
                {(
                  Object.keys(
                    QUOTE_ACCEPTANCE_SOURCE,
                  ) as QuoteAcceptanceSourceValue[]
                ).map((key) => (
                  <option key={key} value={key}>
                    {QUOTE_ACCEPTANCE_SOURCE[key]}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
            <PilotFormField
              label="Az elfogadás napja"
              required
              help="Amikor az ügyfél igent mondott; jövőbeli nap nem lehet."
            >
              <PilotInput
                aria-label="Az elfogadás napja"
                type="date"
                max={today}
                value={day}
                onChange={setDay}
              />
            </PilotFormField>
            <PilotFormField label="Elfogadó neve">
              <PilotInput
                aria-label="Elfogadó neve"
                value={name}
                onChange={setName}
              />
            </PilotFormField>
            <PilotFormField label="Elfogadó email-címe">
              <PilotInput
                aria-label="Elfogadó email-címe"
                type="email"
                value={email}
                onChange={setEmail}
              />
            </PilotFormField>
            {optionalItems.length ? (
              <PilotFormField
                label="Kért opcionális tételek"
                help="Az előleg és a projekt indítása csak a bejelölt opciókkal számol."
              >
                <div className="space-y-1.5">
                  {optionalItems.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 text-sm text-pilot-grey-700"
                    >
                      <input
                        type="checkbox"
                        checked={options.includes(item.id)}
                        onChange={(event) =>
                          setOptions((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((x) => x !== item.id),
                          )
                        }
                      />
                      {item.name}
                    </label>
                  ))}
                </div>
              </PilotFormField>
            ) : null}
            {noteField}
          </>
        ) : null}

        {action === "reject" ? (
          <>
            {reasonSelect(true)}
            {noteField}
          </>
        ) : null}

        {action === "postpone" ? (
          <>
            <PilotFormField
              label="Elhalasztva eddig"
              required
              help="Ekkor érdemes újra felvenni a kapcsolatot."
            >
              <PilotInput
                aria-label="Elhalasztva eddig"
                type="date"
                min={today}
                value={day}
                onChange={setDay}
              />
            </PilotFormField>
            {noteField}
          </>
        ) : null}

        {action === "cancel" ? (
          <>
            <p className="text-sm text-pilot-grey-600">
              A visszavont ajánlat lezárul: nem fogadható el és nem publikálható
              újra. A PDF-ek és a verziók megmaradnak.
            </p>
            {reasonSelect(false)}
            {noteField}
          </>
        ) : null}

        {action === "revoke" ? (
          <>
            <p className="text-sm text-pilot-grey-600">
              Az ajánlat visszakerül nyitott állapotba, és újra szerkeszthető.
              Az elfogadás előzményként megmarad.
            </p>
            <PilotFormField label="Miért vonod vissza" required>
              <textarea
                aria-label="Miért vonod vissza"
                className={NOTE_CLASS}
                maxLength={500}
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
              />
            </PilotFormField>
          </>
        ) : null}
      </div>
    </PilotDrawer>
  );
}
