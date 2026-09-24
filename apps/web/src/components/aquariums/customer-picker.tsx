"use client";
import { Button, Card, FormField, Input } from "@acropora/ui";
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
        <Button
          type="button"
          variant={mode === "existing" ? "primary" : "secondary"}
          onClick={() => {
            setMode("existing");
            onChange({});
          }}
        >
          Meglévő ügyfél
        </Button>
        <Button
          type="button"
          variant={mode === "new" ? "primary" : "secondary"}
          onClick={() => {
            setMode("new");
            onChange({ newCustomer: EMPTY_NEW_CUSTOMER });
          }}
        >
          Új ügyfél
        </Button>
      </div>

      {mode === "existing" ? (
        selection.customerId ? (
          <Card className="flex items-center justify-between p-3">
            <span className="font-semibold text-dusk-900">
              {selection.customerLabel}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearch("");
                onChange({});
              }}
            >
              Csere
            </Button>
          </Card>
        ) : (
          <FormField label="Ügyfél keresése">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Név, telefonszám, e-mail"
            />
            {searching ? (
              <p className="text-xs text-dusk-500">Keresés…</p>
            ) : null}
            {results.length ? (
              <Card className="divide-y">
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
                    {customer.phone ? ` — ${customer.phone}` : ""}
                  </button>
                ))}
              </Card>
            ) : null}
          </FormField>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Név">
            <Input
              value={selection.newCustomer?.displayName ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    displayName: event.target.value,
                  },
                })
              }
            />
          </FormField>
          <FormField label="Telefonszám">
            <Input
              value={selection.newCustomer?.phone ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    phone: event.target.value,
                  },
                })
              }
            />
          </FormField>
          <FormField label="E-mail cím">
            <Input
              type="email"
              value={selection.newCustomer?.email ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    email: event.target.value,
                  },
                })
              }
            />
          </FormField>
          <FormField label="Irányítószám">
            <Input
              value={selection.newCustomer?.addresses?.[0]?.postalCode ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        postalCode: event.target.value,
                      },
                    ],
                  },
                })
              }
            />
          </FormField>
          <FormField label="Város">
            <Input
              value={selection.newCustomer?.addresses?.[0]?.city ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        city: event.target.value,
                      },
                    ],
                  },
                })
              }
            />
          </FormField>
          <FormField label="Cím" className="sm:col-span-2">
            <Input
              value={selection.newCustomer?.addresses?.[0]?.line1 ?? ""}
              onChange={(event) =>
                onChange({
                  newCustomer: {
                    ...(selection.newCustomer ?? EMPTY_NEW_CUSTOMER),
                    addresses: [
                      {
                        ...(selection.newCustomer?.addresses?.[0] ??
                          EMPTY_NEW_CUSTOMER.addresses![0]!),
                        line1: event.target.value,
                      },
                    ],
                  },
                })
              }
            />
          </FormField>
        </div>
      )}
    </div>
  );
}
