"use client";
import {
  PilotButton,
  PilotCard,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import type { CreateCustomerInput, CustomerSummary } from "@acropora/types";
import { useEffect, useState } from "react";
import { customersApi } from "@/lib/api/customers";

export interface CustomerSelection {
  customerId?: string;
  customerLabel?: string;
  newCustomer?: CreateCustomerInput;
}

const EMPTY_NEW_CUSTOMER: CreateCustomerInput = {
  type: "PERSON",
  displayName: "",
  email: "",
  phone: "",
  addresses: [{ type: "OTHER", postalCode: "", city: "", line1: "" }],
};

/**
 * MEGLÉVŐ ÜGYFÉL KERESÉSE, VAGY ÚJ FELVITELE -- UGYANEZEN A LAPON.
 *
 * Balázs döntése (acrobot brief-je, 2026-09-24): az akvárium-lapon az ügyfél
 * VAGY kereshető (meglévő), VAGY ugyanitt felvehető újként. Az új ügyfél a
 * meglévő `Customer`/`CustomerAddress` táblákba kerül -- ez a komponens
 * ezért a MEGLÉVŐ `CreateCustomerInput` alakot tölti ki, nem egy saját,
 * akváriumra írt szabad szöveget.
 */
export function CustomerPicker({
  token,
  selection,
  onChange,
}: {
  token: string;
  selection: CustomerSelection;
  onChange: (selection: CustomerSelection) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(
    selection.newCustomer ? "new" : "existing",
  );
  const [search, setSearch] = useState(selection.customerLabel ?? "");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (mode !== "existing" || selection.customerId) return;
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        search,
        page: "1",
        pageSize: "10",
        // the partners' customer rows too: a partner joined with a customer by the merge IS one row (its "mirror"), and
        // without this the search never offers it, so a zoo that has aquariums could not be picked (40332480)
        includePartnerMirrors: "true",
      });
      customersApi
        .list(token, query, controller.signal)
        .then((response) => setResults(response.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setSearching(false);
    };
  }, [mode, search, selection.customerId, token]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <PilotButton
          type="button"
          variant={mode === "existing" ? "primary" : "secondary"}
          onClick={() => {
            setMode("existing");
            onChange({});
          }}
        >
          Meglévő ügyfél
        </PilotButton>
        <PilotButton
          type="button"
          variant={mode === "new" ? "primary" : "secondary"}
          onClick={() => {
            setMode("new");
            onChange({ newCustomer: EMPTY_NEW_CUSTOMER });
          }}
        >
          Új ügyfél
        </PilotButton>
      </div>

      {mode === "existing" ? (
        selection.customerId ? (
          <PilotCard className="flex items-center justify-between p-3">
            <span className="font-semibold text-dusk-900">
              {selection.customerLabel}
            </span>
            <PilotButton
              type="button"
              variant="secondary"
              onClick={() => {
                setSearch("");
                onChange({});
              }}
            >
              Csere
            </PilotButton>
          </PilotCard>
        ) : (
          <PilotFormField label="Ügyfél keresése" htmlFor="ugyfel-kereses">
            <PilotInput
              id="ugyfel-kereses"
              value={search}
              onChange={setSearch}
              placeholder="Név, telefonszám, e-mail"
            />
            {searching ? (
              <p className="text-xs text-dusk-500">Keresés…</p>
            ) : null}
            {results.length ? (
              <PilotCard className="divide-y">
                {results.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className="block w-full p-2 text-left text-sm hover:bg-dusk-50"
                    onClick={() => {
                      setSearch(customer.displayName);
                      setResults([]);
                      onChange({
                        customerId: customer.id,
                        customerLabel: customer.displayName,
                      });
                    }}
                  >
                    {customer.displayName}
                    {customer.phone ? ` (${customer.phone})` : ""}
                  </button>
                ))}
              </PilotCard>
            ) : null}
          </PilotFormField>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Luca (os-ugyfel-akvarium-hianyos): a helyszínen nincs mindig minden adat */}
          <p
            className="text-xs text-dusk-500 sm:col-span-2"
            data-testid="uj-ugyfel-suggo"
          >
            Csak a név kötelező. A telefonszámot, az e-mail címet és a címet (az
            irányítószámot is) később is pótolhatod; a számla kiállításakor a
            hiányos cím jelezve lesz.
          </p>
          <PilotFormField label="Név" htmlFor="uj-ugyfel-nev">
            <PilotInput
              id="uj-ugyfel-nev"
              value={selection.newCustomer?.displayName ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    displayName: value,
                  },
                })
              }
            />
          </PilotFormField>
          <PilotFormField label="Telefonszám" htmlFor="uj-ugyfel-telefon">
            <PilotInput
              id="uj-ugyfel-telefon"
              value={selection.newCustomer?.phone ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    phone: value,
                  },
                })
              }
            />
          </PilotFormField>
          <PilotFormField label="E-mail cím" htmlFor="uj-ugyfel-email">
            <PilotInput
              id="uj-ugyfel-email"
              type="email"
              value={selection.newCustomer?.email ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    email: value,
                  },
                })
              }
            />
          </PilotFormField>
          <PilotFormField label="Irányítószám" htmlFor="uj-ugyfel-iranyitoszam">
            <PilotInput
              id="uj-ugyfel-iranyitoszam"
              value={selection.newCustomer?.addresses?.[0]?.postalCode ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        postalCode: value,
                      },
                    ],
                  },
                })
              }
            />
          </PilotFormField>
          <PilotFormField label="Város" htmlFor="uj-ugyfel-varos">
            <PilotInput
              id="uj-ugyfel-varos"
              value={selection.newCustomer?.addresses?.[0]?.city ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        city: value,
                      },
                    ],
                  },
                })
              }
            />
          </PilotFormField>
          <PilotFormField
            label="Cím"
            htmlFor="uj-ugyfel-utca"
            className="sm:col-span-2"
          >
            <PilotInput
              id="uj-ugyfel-utca"
              value={selection.newCustomer?.addresses?.[0]?.line1 ?? ""}
              onChange={(value) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        line1: value,
                      },
                    ],
                  },
                })
              }
            />
          </PilotFormField>
        </div>
      )}
    </div>
  );
}
