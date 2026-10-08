"use client";

import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSection,
} from "@acropora/ui";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  hasPermission,
  PERMISSIONS,
  type BillingDocumentCustomer,
  type CustomerDetail,
  type CustomerSummary,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { customersApi } from "@/lib/api/customers";
import { useAuth } from "@/components/auth/auth-provider";

import { BillingNewCustomerForm } from "./billing-new-customer-form";

/**
 * A VEVŐ KÁRTYÁJA (brief 11. pont): név, cím, adószám, e-mail, belső azonosító.
 *
 * AZ EU ADÓSZÁM ÉS A KAPCSOLATTARTÓ a partner-törzsben ma nem létezik. A kártya
 * ezt kimondja ("nincs a partner-törzsben"), nem hagyja ki szó nélkül, és nem
 * talál ki értéket: a kiállításnál ez a két adat nem fog szerepelni.
 */
export function BillingPartnerCard({
  token,
  customer,
  onChange,
  disabled,
}: {
  token: string;
  customer: BillingDocumentCustomer | null;
  /** A vevő, és a fizetési feltétele (napok; `null`: az alapérték). */
  onChange: (
    customer: BillingDocumentCustomer,
    terms: { paymentDueDays: number | null },
  ) => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(customer === null);
  const [creating, setCreating] = useState(false);
  const { session } = useAuth();
  // a new customer is a customer record, with that permission (28105)
  const canCreate = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE),
  );
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  // A KERESÉS HIBÁJA NEM "NINCS TALÁLAT" (Balázs a stage-en, 2026-09-30: "a
  // partnerekbol nem talal senkit"). A választó egy elutasított kérést üres
  // listának mutatott, így a 400 hetekig "Nincs találat."-nak látszott.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearchError(null);
    if (!picking || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      customersApi
        .list(
          token,
          new URLSearchParams({
            search,
            page: "1",
            pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min),
          }),
          controller.signal,
        )
        .then((response) => setResults(response.items))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setSearchError(
            cause instanceof Error && cause.message
              ? `A partnerek keresése nem sikerült: ${cause.message}`
              : "A partnerek keresése nem sikerült.",
          );
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [picking, search, token]);

  /** honnan jött a fizetési nap, ha nem erről a vevő-sorról (7be4a85b) */
  const [termsNote, setTermsNote] = useState<string | null>(null);

  const choose = (detail: CustomerDetail) => {
    onChange(
      {
        id: detail.id,
        name: detail.companyName?.trim() || detail.displayName,
        address: detail.address,
        taxNumber: detail.taxNumber ?? null,
        euTaxNumber: null,
        contactName: null,
        email: detail.email ?? null,
        internalCode: detail.customerNumber,
      },
      {
        paymentDueDays:
          detail.paymentDueDays ?? detail.partnerTerms?.paymentDueDays ?? null,
      },
    );
    setTermsNote(partnerTermsNote(detail));
    setPicking(false);
    setCreating(false);
    setSearch("");
  };

  const pick = async (summary: CustomerSummary) => {
    setError(null);
    try {
      // AZ ADÓSZÁM A RÉSZLETLAPON ÁLL, a listán nem: a kártya ne mutasson
      // hiányt ott, ahol csak nem kértük le.
      choose(await customersApi.detail(token, summary.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A partner nem tölthető be.",
      );
    }
  };

  return (
    <PilotSection
      title="Vevő és számlázási adatok"
      subtitle="A bizonylat a kiválasztott partner számlázási adataival készül."
    >
      {customer && !picking ? (
        <div className="flex flex-col gap-3 rounded-xl bg-pilot-grey-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold text-pilot-grey-900">{customer.name}</p>
            <p className="text-pilot-grey-600">
              {[
                customer.address ?? "Nincs cím a partner-törzsben",
                customer.taxNumber
                  ? `Adószám: ${customer.taxNumber}`
                  : "Nincs adószám",
              ].join(" · ")}
            </p>
            {customer.email ? (
              <p className="text-pilot-aqua-700">{customer.email}</p>
            ) : null}
            <p className="text-xs text-pilot-grey-500">
              Partner-azonosító: {customer.internalCode} · EU adószám és
              kapcsolattartó: nincs a partner-törzsben
            </p>
            {termsNote ? (
              <p className="text-xs text-pilot-amber-700">{termsNote}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {customer.taxNumber || customer.email ? (
              <PilotBadge variant="success">Vevő rendben</PilotBadge>
            ) : null}
            <PilotButton
              variant="secondary"
              size="action"
              disabled={disabled}
              onClick={() => setPicking(true)}
            >
              Módosítás
            </PilotButton>
          </div>
        </div>
      ) : creating ? (
        <BillingNewCustomerForm
          token={token}
          initialSearch={search}
          onSaved={choose}
          onPickExisting={(summary) => void pick(summary)}
          onClose={() => setCreating(false)}
        />
      ) : (
        <div className="space-y-3">
          <PilotInput
            aria-label="Partner keresése"
            placeholder="Partner neve, adószáma, azonosítója vagy e-mail címe"
            value={search}
            onChange={setSearch}
            disabled={disabled}
          />
          {error || searchError ? (
            <p role="alert" className="text-xs text-pilot-red-700">
              {error ?? searchError}
            </p>
          ) : null}
          {searchError ? null : results.length > 0 ? (
            <ul className="divide-y divide-pilot-grey-100 rounded-lg ring-1 ring-pilot-grey-200">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => void pick(result)}
                    className="flex w-full cursor-pointer flex-col items-start px-4 py-2 text-left hover:bg-pilot-aqua-50"
                  >
                    <span className="text-sm font-medium text-pilot-grey-900">
                      {result.companyName?.trim() || result.displayName}
                    </span>
                    <span className="text-xs text-pilot-grey-500">
                      {result.customerNumber}
                      {result.address ? ` · ${result.address}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : search.trim().length >= 2 ? (
            <p className="text-xs text-pilot-grey-500">Nincs találat.</p>
          ) : null}
          {canCreate && !disabled ? (
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => setCreating(true)}
            >
              Új vevő felvétele
            </PilotButton>
          ) : null}
          {customer ? (
            <PilotButton
              variant="ghost"
              size="action"
              onClick={() => setPicking(false)}
            >
              Mégse
            </PilotButton>
          ) : null}
        </div>
      )}
    </PilotSection>
  );
}

/**
 * A FIZETÉSI NAP FORRÁSA, HA NEM A VÁLASZTOTT VEVŐ-SORÉ (kártya 7be4a85b):
 * ugyanaz a cég több vevő-soron is állhat, és a napot a Partnerek oldalon
 * állítják. A szöveg kimondja, honnan jött a határidő, hogy ne látsszon
 * önkényesnek.
 */
export function partnerTermsNote(detail: CustomerDetail): string | null {
  if (detail.paymentDueDays !== null || !detail.partnerTerms) return null;
  return `Fizetési határidő: ${detail.partnerTerms.paymentDueDays} nap, a(z) ${detail.partnerTerms.partnerName} partner beállításából (ezen a vevő-soron nincs megadva).`;
}
