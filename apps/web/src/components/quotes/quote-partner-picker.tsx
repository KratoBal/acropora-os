"use client";

import { PilotButton, PilotInput } from "@acropora/ui";
import { CUSTOMER_LIST_PAGE_SIZE, type CustomerSummary } from "@acropora/types";
import { useEffect, useState } from "react";

import { customersApi } from "@/lib/api/customers";

import { errorText, isAbort } from "./quote-format";
import { QuoteNewPerson } from "./quote-new-person";

/**
 * THE QUOTE'S PARTNER PICKER (extracted from the "new quote" page so the quote detail page changes a draft's partner with the SAME
 * search; Luca 2026-11-20). A search box over the one customer register (the partners' customer mirrors included), the answer list,
 * and "Új magánszemély" for who may create one. It only PICKS: the caller decides what a pick does.
 */
export function QuotePartnerPicker({
  token,
  canCreateCustomer,
  onSelect,
}: {
  token: string;
  canCreateCustomer: boolean;
  onSelect: (customer: CustomerSummary) => void;
}) {
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // the text of the search that has ANSWERED: an empty list reads as "no match" only for it, never while one is in flight
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      setAnswered(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        search: search.trim(),
        page: "1",
        // the API's own lower bound: a smaller page is a 400, not a short list
        // (Balázs on stage, 2026-10-08: the search listed nothing)
        pageSize: String(CUSTOMER_LIST_PAGE_SIZE.min),
        // the partners' customer rows too (their "mirror" of the one partner register): a partner joined with a
        // customer by the merge IS a mirror, and without this the search never offers it (Luca, 2026-11-05)
        includePartnerMirrors: "true",
      });
      customersApi
        .list(token, query, controller.signal)
        .then((response) => {
          setResults(response.items);
          setSearchError(null);
          setAnswered(search.trim());
        })
        .catch((cause: unknown) => {
          if (isAbort(cause)) return;
          setResults([]);
          // a failed search says so; an empty list would look like "no match"
          setSearchError(errorText(cause, "A partnerek nem kereshetők."));
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [search, token]);

  return (
    <div className="space-y-2">
      {creatingPerson ? (
        <QuoteNewPerson
          token={token}
          onCancel={() => setCreatingPerson(false)}
          onCreated={(created) => {
            setCreatingPerson(false);
            setResults([]);
            onSelect(created);
          }}
        />
      ) : null}
      <PilotInput
        aria-label="Partner keresése"
        placeholder="Partner neve, e-mail vagy telefon"
        value={search}
        onChange={setSearch}
      />
      {searchError ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {searchError}
        </p>
      ) : null}
      {!searchError &&
      results.length === 0 &&
      answered !== null &&
      answered === search.trim() ? (
        <p role="status" className="text-sm text-pilot-grey-600">
          Nincs ilyen partner. Próbálj rövidebb szövegrészt, vagy vedd fel a
          Partnerek között.
        </p>
      ) : null}
      {results.length ? (
        <ul
          aria-label="Találatok"
          className="divide-y rounded-lg border border-pilot-grey-200 bg-white"
        >
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-pilot-grey-50"
                onClick={() => {
                  setResults([]);
                  onSelect(item);
                }}
              >
                {item.displayName}
                {item.partnerMirror ? (
                  <span className="ml-2 text-xs text-pilot-grey-500">
                    partner
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canCreateCustomer && !creatingPerson ? (
        <PilotButton
          variant="secondary"
          onClick={() => setCreatingPerson(true)}
        >
          Új magánszemély
        </PilotButton>
      ) : null}
    </div>
  );
}
