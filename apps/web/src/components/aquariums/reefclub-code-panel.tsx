"use client";

import { Alert } from "@acropora/ui";
import type { CustomerDetail } from "@acropora/types";
import { useEffect, useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import { aquariumsApi, type IssuedReefClubLinkCode } from "@/lib/api/aquariums";
import { customersApi } from "@/lib/api/customers";

/** A kód lejárata a bolti időzónában, ahogy a kolléga a vevőnek felolvassa. */
export function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Budapest",
  }).format(new Date(iso));
}

/**
 * Why this customer cannot get a ReefClub code, or null. The SERVER decides (apps/api
 * `issueCode`): a company's aquariums may not go into a private account, and a code needs
 * an e-mail address because every new link is announced there. The panel names the same
 * reasons BEFORE the click so nobody presses a button that must refuse; if the server
 * refuses anyway, its own words are shown.
 */
export function codeBlocker(
  customer: Pick<CustomerDetail, "type" | "email">,
): string | null {
  if (customer.type !== "PERSON")
    return "ReefClub-kód csak magánszemély vevőnek adható ki: egy cég akváriumai nem kerülhetnek magánfiókba.";
  if (!customer.email?.trim())
    return "A vevőnek nincs e-mail címe. ReefClub-kód csak e-mail címmel adható ki, mert minden új összekapcsolásról értesítést kap.";
  return null;
}

type Customer =
  | { state: "loading" }
  | { state: "ready"; customer: CustomerDetail }
  | { state: "failed"; message: string };

/**
 * "ReefClub-kód kiadása" the customer's aquarium page (card of reefclub-kod-gomb): the shop
 * gives the customer a one-time code that connects their ReefClub account to the shop's
 * records (plan 3.3). The code is shown ONCE, copyable, with its expiry; the server keeps
 * only its hash, so a closed page cannot show it again — a new code is issued instead.
 */
export function ReefClubCodePanel({
  token,
  customerId,
}: {
  token: string;
  customerId: string;
}) {
  const [customer, setCustomer] = useState<Customer>({ state: "loading" });
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedReefClubLinkCode | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCustomer({ state: "loading" });
    setIssued(null);
    setError(null);
    customersApi
      .detail(token, customerId, controller.signal)
      .then((found) => setCustomer({ state: "ready", customer: found }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setCustomer({
          state: "failed",
          message:
            cause instanceof Error ? cause.message : "A vevő nem tölthető be.",
        });
      });
    return () => controller.abort();
  }, [token, customerId]);

  async function issue() {
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      setIssued(
        await aquariumsApi.issueReefClubCode(token, customerId, sendEmail),
      );
    } catch (cause) {
      setIssued(null);
      setError(
        cause instanceof Error ? cause.message : "A kód kiadása nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("yes");
    } catch {
      // no clipboard (insecure context, refused): the code is on the screen to be selected
      setCopied("no");
    }
  }

  if (customer.state === "loading")
    return <p className="text-sm text-dusk-500">ReefClub-kód: betöltés…</p>;
  if (customer.state === "failed")
    return (
      <Alert
        variant="danger"
        title="A ReefClub-kód nem adható ki"
        description={customer.message}
      />
    );

  const blocker = codeBlocker(customer.customer);

  return (
    <div className="flex flex-col gap-3" data-testid="reefclub-code-panel">
      <div>
        <p className="text-sm font-semibold">ReefClub-kód</p>
        <p className="text-xs text-dusk-500">
          A vevő ezzel a kóddal köti össze a ReefClub-fiókját a bolti
          nyilvántartással. Egyszer használható, és lejár. A kód csak a kiadás
          után látszik, később nem olvasható vissza.
        </p>
      </div>

      {blocker ? (
        <p
          role="note"
          className="rounded-lg bg-dusk-50 p-3 text-sm text-dusk-700"
        >
          {blocker}
        </p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={sendEmail}
              onChange={(event) => setSendEmail(event.target.checked)}
            />
            <span>
              A kódot küldjük el a vevő e-mail címére is (
              {customer.customer.email}).
            </span>
          </label>
          <div>
            <PilotButton
              type="button"
              disabled={busy}
              onClick={() => void issue()}
            >
              {busy ? "Kiadás…" : "ReefClub-kód kiadása"}
            </PilotButton>
          </div>
        </>
      )}

      {error ? (
        <Alert
          variant="danger"
          title="A kód nem adható ki"
          description={error}
        />
      ) : null}

      {issued ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-dusk-200 p-3"
          data-testid="reefclub-issued-code"
        >
          <p className="text-xs text-dusk-500">
            A vevőnek ezt a kódot kell megadnia a ReefClubban:
          </p>
          <p
            className="select-all font-mono text-2xl font-semibold tracking-widest"
            aria-label="ReefClub-kód"
          >
            {issued.code}
          </p>
          <p className="text-sm text-dusk-700">
            Érvényes eddig: <strong>{formatExpiry(issued.expiresAt)}</strong>
          </p>
          {issued.emailedTo ? (
            <p className="text-sm text-dusk-700">
              Elküldtük ide: {issued.emailedTo}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <PilotButton
              type="button"
              variant="secondary"
              onClick={() => void copy(issued.code)}
            >
              Másolás
            </PilotButton>
            {copied === "yes" ? (
              <span className="text-sm text-emerald-700">Kimásolva.</span>
            ) : null}
            {copied === "no" ? (
              <span className="text-sm text-dusk-600">
                A vágólap nem érhető el: jelöld ki és másold a kódot.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
