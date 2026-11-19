"use client";

import type { WebshopOrderTaxCheck } from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopOrdersApi } from "@/lib/api/webshop-orders";

/** Mit mond a kezelőnek az ellenőrzés eredménye. A figyelmeztetés (név-eltérés) nem tiltás, a számlát csak a NAV "nincs ilyen" és a hibás alak állítja meg. */
function verdict(check: WebshopOrderTaxCheck, company: string | null) {
  switch (check.state) {
    case "VALID":
      return {
        tone: check.nameMatches === false ? "warn" : "ok",
        text:
          check.nameMatches === false
            ? `A NAV ismeri, de más néven: ${check.navName ?? "—"}. A rendelés cégneve${company ? ` (${company})` : ""} nem egyezik vele: nézd meg, hogy a vevő a saját adószámát adta-e meg.`
            : `A NAV ismeri${check.navName ? `: ${check.navName}` : ""}.`,
      } as const;
    case "INVALID":
      return {
        tone: "bad",
        text: `A NAV szerint nincs ilyen adószám. Javítsd (Számlázási cím, Szerkesztés), mielőtt a számlát kiállítod: erre a szerver nem állít ki számlát.`,
      } as const;
    case "MALFORMED":
      return {
        tone: "bad",
        text: "Az adószám alakja nem érvényes (magyar: 11 számjegy, érvényes ellenőrző számjeggyel; vagy közösségi, országkóddal). Javítsd, mielőtt a számlát kiállítod.",
      } as const;
    case "UNAVAILABLE":
      return {
        tone: "warn",
        text: "A NAV most nem válaszolt. Ez NEM azt jelenti, hogy az adószám rossz; a számla emiatt nem akad el, később újra megnézheted.",
      } as const;
    case "NONE":
      return {
        tone: "ok",
        text: "Közösségi (vagy nem magyar alakú) adószám: a NAV-nál nem ellenőrizhető.",
      } as const;
  }
}

const TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "text-pilot-grey-600",
  warn: "text-amber-700",
  bad: "text-red-700",
};

/**
 * A SZÁMLÁZÁSI CÍM ADÓSZÁMA ÉS A NAV-ELLENŐRZÉSE (kártya c977aed2, P2): az adószám a címen áll (a kirakat pénztára a céges
 * vásárlásnál adja át), és a gomb a NAV-nál nézi meg. Kérésre fut, nem az adatlap megnyitásakor (minden hívás egy NAV-kérés).
 */
export function OrderTaxCheck({
  orderId,
  taxNumber,
  company,
}: {
  orderId: string;
  taxNumber: string | null;
  company: string | null;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [check, setCheck] = useState<WebshopOrderTaxCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!taxNumber) return null;
  const run = () => {
    setBusy(true);
    setError(null);
    void webshopOrdersApi
      .taxCheck(token, orderId)
      .then(setCheck)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az ellenőrzés nem sikerült.",
        ),
      )
      .finally(() => setBusy(false));
  };
  const shown = check ? verdict(check, company) : null;
  return (
    <div className="mt-2" data-testid="adoszam-ellenorzes">
      <span className="block text-xs text-pilot-grey-500">
        Adószám: <span className="text-pilot-grey-900">{taxNumber}</span>
      </span>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-1 rounded-lg border border-pilot-grey-200 bg-white px-3 py-1 text-xs font-medium text-pilot-grey-900 hover:border-pilot-accent-warm disabled:opacity-50"
      >
        {busy ? "Ellenőrzés…" : "Ellenőrzés a NAV-nál"}
      </button>
      {shown ? (
        <p
          className={`mt-1 text-xs ${TONE[shown.tone]}`}
          data-testid="adoszam-eredmeny"
        >
          {shown.text}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
