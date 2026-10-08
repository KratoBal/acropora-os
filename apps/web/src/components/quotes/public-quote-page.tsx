"use client";

import { PilotButton, PilotInput } from "@acropora/ui";
import type { PublicQuoteDto } from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { API_PREFIX } from "@/lib/api/api-prefix";

import {
  formatQuantity,
  formatQuoteDay,
  formatQuoteMoney,
} from "./quote-format";

const base = (token: string) =>
  `${API_PREFIX}/public/quotes/${encodeURIComponent(token)}`;

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
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // one id per page: a double click or a retry is the same yes
  const requestId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    let live = true;
    fetch(base(token), { cache: "no-store" })
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

  const accept = async () => {
    setBusy(true);
    setAcceptError(null);
    try {
      const response = await fetch(`${base(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          selectedOptionalItemIds: chosen,
          requestId,
        }),
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
              href={`${base(token)}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Az ajánlat PDF-ben
            </a>
          </header>

          <section className="overflow-x-auto rounded-xl bg-white ring-1 ring-pilot-grey-200">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-pilot-grey-50 text-left text-xs text-pilot-grey-600">
                <tr>
                  <th className="px-4 py-2">Tétel</th>
                  <th className="px-4 py-2 text-right">Mennyiség</th>
                  <th className="px-4 py-2 text-right">Nettó egységár</th>
                  <th className="px-4 py-2 text-right">Nettó</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pilot-grey-100">
                {quote.items.map((item, index) => (
                  <tr key={`${index}-${item.name}`}>
                    <td className="px-4 py-2 text-pilot-grey-900">
                      {item.isOptional && item.id && quote.state === "OPEN" ? (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={chosen.includes(item.id)}
                            onChange={(event) =>
                              setChosen((current) =>
                                event.target.checked
                                  ? [...current, item.id!]
                                  : current.filter((id) => id !== item.id),
                              )
                            }
                          />
                          {item.name}
                          <span className="text-xs text-pilot-grey-500">
                            (opcionális)
                          </span>
                        </label>
                      ) : (
                        <>
                          {item.name}
                          {item.isOptional ? (
                            <span className="ml-2 text-xs text-pilot-grey-500">
                              (opcionális)
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-pilot-grey-700">
                      {formatQuantity(item.quantity)} {item.unit}
                    </td>
                    <td className="px-4 py-2 text-right text-pilot-grey-700">
                      {formatQuoteMoney(item.unitNetPrice, quote.currency)}
                    </td>
                    <td className="px-4 py-2 text-right text-pilot-grey-900">
                      {formatQuoteMoney(item.netTotal, quote.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 border-t border-pilot-grey-100 px-4 py-3 text-right text-sm">
              <p className="font-semibold text-pilot-grey-900">
                Nettó összesen:{" "}
                {formatQuoteMoney(quote.netTotal, quote.currency)}
              </p>
              {Number(quote.optionalNetTotal) > 0 ? (
                <p className="text-pilot-grey-600">
                  Opcionális tételek: +
                  {formatQuoteMoney(quote.optionalNetTotal, quote.currency)}
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
