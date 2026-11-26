"use client";

import {
  PilotButton,
  PilotDataTable,
  PilotInput,
  type PilotTableColumn,
} from "@acropora/ui";
import type { PublicQuoteDto, PublicQuoteTotalDto } from "@acropora/types";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { publicQuotesApi } from "@/lib/api/public-quotes";

import {
  formatQuantity,
  formatQuoteDay,
  formatQuoteMoney,
} from "./quote-format";

/** The server's sentence when there is one (404, 409, 429), else ours. */
async function failure(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // not JSON: the fallback says it
  }
  return fallback;
}

type QuoteItem = PublicQuoteDto["items"][number];

/**
 * THE TAG UNDER AN OPTIONAL ITEM'S NAME (card 2540d9d4, Luca 2026-11-26), as on the PDF: an addition, or the item it stands in for
 * (the server names it: `replacesName`).
 */
export function optionalItemLabel(item: QuoteItem): string {
  return item.replacesName
    ? `Opcionális · „${item.replacesName}” helyett`
    : "Opcionális · kiegészítés";
}

/** The tag as a line of its own under the name. */
function OptionalTag({ item }: { item: QuoteItem }) {
  return (
    <span className="block text-xs font-semibold text-pilot-aqua-700">
      {optionalItemLabel(item)}
    </span>
  );
}

/** A kiváltott tétel jelölése (a név marad látható, az összeg áthúzva, a végösszegbe nem számít). */
function ReplacedTag() {
  return (
    <span className="block text-xs font-semibold text-pilot-grey-600">
      Kiváltva
    </span>
  );
}

export const QUOTE_ITEM_TABLE_MIN_WIDTH = 640;

/*
  AZ AJÁNLAT TÉTELEI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Az ügyfél telefonon nyitja
  meg a linket, ott a tétel egy kártya: a megnevezés (és az opcionális tétel jelölőnégyzete) a címe,
  a többi oszlop a felirata mellett áll. Az opcionális tétel jelölőnégyzete csak nyitott ajánlatnál
  kapcsolható (`canChoose`), ezért az oszlopok függvényből jönnek.
*/
export function quoteItemColumns({
  currency,
  canChoose,
  chosen,
  setChosen,
  isReplaced = () => false,
}: {
  currency: string;
  canChoose: boolean;
  chosen: string[];
  setChosen: Dispatch<SetStateAction<string[]>>;
  /** a kiváltott tétel (a kiválasztás szerint): áthúzva, "Kiváltva" jelöléssel, a végösszegbe nem számít */
  isReplaced?: (item: QuoteItem) => boolean;
}): PilotTableColumn<QuoteItem>[] {
  return [
    {
      id: "name",
      header: "Tétel",
      cell: (item) => (
        <span
          className={
            isReplaced(item)
              ? "text-pilot-grey-500 line-through"
              : "text-pilot-grey-900"
          }
        >
          {item.isOptional && item.id && canChoose ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(item.id)}
                onChange={(event) => {
                  // Read before the updater runs: a controlled checkbox is put back to its
                  // state value, so a lazily run updater would see the old `checked`.
                  const checked = event.target.checked;
                  setChosen((current) =>
                    checked
                      ? [...current, item.id!]
                      : current.filter((id) => id !== item.id),
                  );
                }}
              />
              <span>
                {item.name}
                <OptionalTag item={item} />
              </span>
            </label>
          ) : (
            <>
              {item.name}
              {item.isOptional ? <OptionalTag item={item} /> : null}
              {isReplaced(item) ? <ReplacedTag /> : null}
            </>
          )}
        </span>
      ),
    },
    {
      id: "quantity",
      header: "Mennyiség",
      width: "120px",
      align: "right",
      nowrap: true,
      cell: (item) => `${formatQuantity(item.quantity)} ${item.unit}`,
    },
    {
      id: "unitNet",
      header: "Nettó egységár",
      width: "150px",
      align: "right",
      nowrap: true,
      cell: (item) =>
        isReplaced(item) ? (
          <span className="line-through">
            {formatQuoteMoney(item.unitNetPrice, currency, {
              fractionDigits: 2,
            })}
          </span>
        ) : (
          formatQuoteMoney(item.unitNetPrice, currency, { fractionDigits: 2 })
        ),
    },
    {
      id: "netTotal",
      header: "Nettó",
      width: "130px",
      align: "right",
      nowrap: true,
      cell: (item) =>
        isReplaced(item) ? (
          <span className="line-through">
            {formatQuoteMoney(item.netTotal, currency)}
          </span>
        ) : (
          formatQuoteMoney(item.netTotal, currency)
        ),
    },
  ];
}

/**
 * AZ ÜGYFÉL OLDALA AZ ELFOGADÓ LINKEN (#1582 P4b), bejelentkezés nélkül: mit
 * ajánlunk, a PDF, és az igen. A token maga a kulcs; a szerver minden nem
 * működő linkre ugyanazt mondja.
 */
export function PublicQuotePage({ token }: { token: string }) {
  const [quote, setQuote] = useState<PublicQuoteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  // a kiválasztás végösszege: a SZERVER számolja (kiváltott tétel), a lap csak mutatja
  const [selection, setSelection] = useState<PublicQuoteTotalDto | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // one id per page: a double click or a retry is the same yes
  const requestId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let live = true;
    publicQuotesApi
      .view(token)
      .then(async (response) => {
        if (!live) return;
        if (!response.ok)
          setError(await failure(response, "Az ajánlat nem tölthető be."));
        else setQuote((await response.json()) as PublicQuoteDto);
      })
      .catch(() => live && setError("Az ajánlat nem tölthető be."));
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    if (!chosen.length || quote?.state !== "OPEN") {
      setSelection(null);
      return;
    }
    let live = true;
    publicQuotesApi
      .total(token, { selectedOptionalItemIds: chosen })
      .then(async (response) => {
        if (!live) return;
        setSelection(
          response.ok ? ((await response.json()) as PublicQuoteTotalDto) : null,
        );
      })
      .catch(() => live && setSelection(null));
    return () => {
      live = false;
    };
  }, [chosen, quote?.state, token]);

  const accept = async () => {
    setBusy(true);
    setAcceptError(null);
    try {
      const response = await publicQuotesApi.accept(token, {
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        selectedOptionalItemIds: chosen,
        requestId,
      });
      if (!response.ok)
        setAcceptError(
          await failure(response, "Az elfogadás nem sikerült. Próbáld újra."),
        );
      else setQuote((await response.json()) as PublicQuoteDto);
    } catch {
      setAcceptError("Az elfogadás nem sikerült. Próbáld újra.");
    } finally {
      setBusy(false);
    }
  };

  const offered = quote?.items.filter((item) => !item.isOptional) ?? [];
  const optional = quote?.items.filter((item) => item.isOptional) ?? [];
  // az áthúzott (kiváltott) tétel: elfogadás után a szerver jelölése, előtte a bejelöléskor kért kiválasztás szerint
  const isReplaced = (item: QuoteItem) =>
    quote?.state === "ACCEPTED"
      ? item.replaced
      : (selection?.replacedItems.includes(quote?.items.indexOf(item) ?? -1) ??
        false);
  const columns = quoteItemColumns({
    currency: quote?.currency ?? "HUF",
    canChoose: quote?.state === "OPEN",
    chosen,
    setChosen,
    isReplaced,
  });
  const rowKey = (item: QuoteItem) =>
    item.id ?? `${quote?.items.indexOf(item)}-${item.name}`;

  return (
    <PilotThemeRoot
      theme="light"
      className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-10"
    >
      {error ? (
        <div role="alert" className="rounded-xl bg-white p-6 text-center">
          <p className="text-base font-semibold text-pilot-grey-900">{error}</p>
          <p className="mt-2 text-sm text-pilot-grey-600">
            Ha kérdésed van, írj nekünk: info@acropora.hu
          </p>
        </div>
      ) : !quote ? (
        <p className="text-sm text-pilot-grey-600">Betöltés…</p>
      ) : (
        <>
          <header className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-pilot-grey-500">
              Acropora Kft. árajánlat · {quote.quoteNumber} · v
              {quote.versionNumber}
            </p>
            <h1 className="text-2xl font-semibold text-pilot-grey-900">
              {quote.title}
            </h1>
            <p className="text-sm text-pilot-grey-600">
              {quote.customerName ? `${quote.customerName} · ` : ""}Érvényes:{" "}
              {formatQuoteDay(quote.validUntil)}
            </p>
            <a
              className="inline-block text-sm font-medium text-pilot-aqua-700 underline"
              href={publicQuotesApi.pdfHref(token)}
              target="_blank"
              rel="noreferrer"
            >
              Az ajánlat PDF-ben
            </a>
          </header>

          {/*
            THE OPTIONAL ITEMS APART (card 2540d9d4, Luca 2026-11-26), as on the PDF: the offered items first, then the optional ones
            in a group of their own that says they are not part of the total, each tagged; under the total, the one with them.
          */}
          <section className="rounded-xl bg-white ring-1 ring-pilot-grey-200">
            {offered.length ? (
              <PilotDataTable
                columns={columns}
                rows={offered}
                rowKey={rowKey}
                rowTestId="quote-item-row"
                minWidth={QUOTE_ITEM_TABLE_MIN_WIDTH}
              />
            ) : null}
            {optional.length ? (
              <div
                className={
                  offered.length ? "border-t border-pilot-grey-100" : undefined
                }
              >
                <div className="px-4 pt-4">
                  <h2 className="text-sm font-semibold text-pilot-grey-900">
                    Opcionális tételek
                  </h2>
                  <p className="text-xs text-pilot-grey-600">
                    Nem részei a végösszegnek.
                    {quote.state === "OPEN"
                      ? " Jelöld be, amelyiket kéred."
                      : ""}
                  </p>
                </div>
                <PilotDataTable
                  columns={columns}
                  rows={optional}
                  rowKey={rowKey}
                  rowTestId="quote-item-row"
                  minWidth={QUOTE_ITEM_TABLE_MIN_WIDTH}
                />
              </div>
            ) : null}
            <div className="space-y-1 border-t border-pilot-grey-100 px-4 py-3 text-right text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {quote.state === "ACCEPTED" && quote.acceptedNetTotal
                  ? "Elfogadott nettó összeg: "
                  : "Nettó összesen: "}
                {formatQuoteMoney(
                  quote.state === "ACCEPTED" && quote.acceptedNetTotal
                    ? quote.acceptedNetTotal
                    : quote.netTotal,
                  quote.currency,
                )}{" "}
                + ÁFA
              </p>
              {selection && chosen.length ? (
                <p className="font-semibold text-pilot-aqua-700">
                  A kiválasztott tételekkel:{" "}
                  {formatQuoteMoney(selection.netTotal, quote.currency)} + ÁFA
                </p>
              ) : null}
              {optional.length && quote.state !== "ACCEPTED" ? (
                <p className="text-pilot-grey-600">
                  Az opcionális tételekkel együtt:{" "}
                  {formatQuoteMoney(
                    quote.netTotalWithOptionals,
                    quote.currency,
                  )}{" "}
                  + ÁFA
                </p>
              ) : null}
            </div>
          </section>

          {quote.state === "ACCEPTED" ? (
            <div
              role="status"
              className="rounded-xl bg-pilot-aqua-50 p-5 text-sm text-pilot-grey-900"
            >
              Köszönjük, az ajánlatot elfogadtad
              {quote.acceptedAt ? ` (${formatQuoteDay(quote.acceptedAt)})` : ""}
              . Hamarosan jelentkezünk a részletekkel.
            </div>
          ) : quote.state === "CLOSED" ? (
            <div className="rounded-xl bg-white p-5 text-sm text-pilot-grey-700">
              Ez az ajánlat már nem fogadható el. Ha érdekel, kérj tőlünk újat.
            </div>
          ) : (
            <section className="space-y-3 rounded-xl bg-white p-5 ring-1 ring-pilot-grey-200">
              <h2 className="text-base font-semibold text-pilot-grey-900">
                Az ajánlat elfogadása
              </h2>
              <PilotInput
                aria-label="A neved"
                placeholder="A neved"
                value={name}
                onChange={setName}
              />
              <PilotInput
                aria-label="E-mail címed"
                placeholder="E-mail címed (nem kötelező)"
                value={email}
                onChange={setEmail}
              />
              <label className="flex items-start gap-2 text-sm text-pilot-grey-700">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                Elfogadom az ajánlatot a fenti tételekkel
                {chosen.length ? " és a kiválasztott opciókkal" : ""}, a PDF
                szerinti feltételekkel.
              </label>
              {acceptError ? (
                <p role="alert" className="text-sm text-pilot-red-700">
                  {acceptError}
                </p>
              ) : null}
              <PilotButton
                disabled={busy || !agreed || name.trim().length < 2}
                onClick={() => void accept()}
              >
                Elfogadom
              </PilotButton>
            </section>
          )}
        </>
      )}
    </PilotThemeRoot>
  );
}
