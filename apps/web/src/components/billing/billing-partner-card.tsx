"use client";

import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSection,
} from "@acropora/ui";
import type { BillingDocumentCustomer, CustomerSummary } from "@acropora/types";
import { useEffect, useState } from "react";

import { customersApi } from "@/lib/api/customers";

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
  onChange: (customer: BillingDocumentCustomer) => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(customer === null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picking || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      customersApi
        .list(
          token,
          new URLSearchParams({ search, page: "1", pageSize: "8" }),
          controller.signal,
        )
        .then((response) => setResults(response.items))
        .catch(() => setResults([]));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [picking, search, token]);

  const pick = async (summary: CustomerSummary) => {
    setError(null);
    try {
      // AZ ADÓSZÁM A RÉSZLETLAPON ÁLL, a listán nem: a kártya ne mutasson
      // hiányt ott, ahol csak nem kértük le.
      const detail = await customersApi.detail(token, summary.id);
      onChange({
        id: detail.id,
        name: detail.companyName?.trim() || detail.displayName,
        address: detail.address,
        taxNumber: detail.taxNumber ?? null,
        euTaxNumber: null,
        contactName: null,
        email: detail.email ?? null,
        internalCode: detail.customerNumber,
      });
      setPicking(false);
      setSearch("");
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
      ) : (
        <div className="space-y-3">
          <PilotInput
            aria-label="Partner keresése"
            placeholder="Partner neve, azonosítója vagy e-mail címe"
            value={search}
            onChange={setSearch}
            disabled={disabled}
          />
          {error ? (
            <p role="alert" className="text-xs text-pilot-red-700">
              {error}
            </p>
          ) : null}
          {results.length > 0 ? (
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
