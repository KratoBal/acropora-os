"use client";

import {
  Alert,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotFormField,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CustomerSummary,
  type QuoteTemplateSummaryDto,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { customersApi } from "@/lib/api/customers";
import { quotesApi } from "@/lib/api/quotes";

import { dayAfter, errorText, formatQuoteDay, isAbort } from "./quote-format";
import { QUOTES_PATH } from "./quote-list-page";

const VALIDITY_DAYS = [15, 30, 60, 90];
const CURRENCIES = ["HUF", "EUR"];

/**
 * ÚJ ÁRAJÁNLAT (#1582 P1; Figma 35 · OS / Offers / New, 567:190). Az
 * alapadatok és a kiinduló sablon után a szerkesztő nyílik meg. A tervben álló
 * Kapcsolattartó, Projekt, Nyelv és Ajánlat típusa mezőnek nincs helye a
 * modellben, ezért nem szerepel (a PR leírása sorolja).
 */
export function QuoteNewPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_MANAGE),
  );

  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [title, setTitle] = useState("");
  const [validityDays, setValidityDays] = useState(30);
  const [currency, setCurrency] = useState("HUF");
  const [templates, setTemplates] = useState<QuoteTemplateSummaryDto[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    quotesApi
      .templates(token, controller.signal)
      .then(setTemplates)
      .catch(() => setTemplates([]));
    return () => controller.abort();
  }, [canManage, token]);

  useEffect(() => {
    if (customer || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        search: search.trim(),
        page: "1",
        pageSize: "8",
      });
      customersApi
        .list(token, query, controller.signal)
        .then((response) => setResults(response.items))
        .catch((cause: unknown) => {
          if (!isAbort(cause)) setResults([]);
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [customer, search, token]);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const ready = Boolean(customer && title.trim());

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const chosen = templates.find((t) => t.id === id);
    if (chosen) setValidityDays(chosen.defaultValidityDays);
  };

  const submit = async () => {
    if (!ready || !customer) return;
    setSaving(true);
    setError(null);
    try {
      const created = await quotesApi.create(token, {
        title: title.trim(),
        customerId: customer.id,
        validUntil: dayAfter(validityDays),
        currency,
        ...(templateId ? { templateId } : {}),
      });
      router.push(`${QUOTES_PATH}/${created.id}/szerkesztes`);
    } catch (cause) {
      setError(errorText(cause, "Az ajánlat nem hozható létre."));
      setSaving(false);
    }
  };

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod új ajánlathoz"
        description="quotes.manage jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Pénzügy / Árajánlatok"
        title="Új árajánlat"
        description="Az alapadatok és a kiinduló sablon megadása után nyílik meg az ajánlatszerkesztő."
        actions={
          <div className="flex gap-3">
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() => router.push(QUOTES_PATH)}
            >
              Mégse
            </PilotButton>
            <PilotButton
              size="regular"
              disabled={!ready || saving}
              title={ready ? undefined : "A partner és a cím kötelező."}
              onClick={() => void submit()}
            >
              Ajánlat létrehozása
            </PilotButton>
          </div>
        }
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <PilotCard>
            <PilotCardHeader title="Ajánlat alapadatai" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <PilotFormField
                label="Partner"
                required
                className="sm:col-span-2"
              >
                {customer ? (
                  <div className="flex items-center justify-between rounded-lg border border-pilot-grey-200 px-3 py-2">
                    <span className="font-semibold">
                      {customer.displayName}
                    </span>
                    <PilotButton
                      variant="ghost"
                      onClick={() => {
                        setCustomer(null);
                        setSearch("");
                      }}
                    >
                      Csere
                    </PilotButton>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <PilotInput
                      aria-label="Partner keresése"
                      placeholder="Partner neve, e-mail vagy telefon"
                      value={search}
                      onChange={setSearch}
                    />
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
                                setCustomer(item);
                                setResults([]);
                              }}
                            >
                              {item.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </PilotFormField>
              <PilotFormField
                label="Ajánlat címe"
                required
                className="sm:col-span-2"
              >
                <PilotInput
                  aria-label="Ajánlat címe"
                  value={title}
                  onChange={setTitle}
                />
              </PilotFormField>
              <PilotFormField label="Érvényesség">
                <PilotSelect
                  chevron
                  aria-label="Érvényesség"
                  value={String(validityDays)}
                  onChange={(value) => setValidityDays(Number(value))}
                >
                  {[...new Set([...VALIDITY_DAYS, validityDays])]
                    .sort((a, b) => a - b)
                    .map((days) => (
                      <option key={days} value={days}>
                        {days} nap
                      </option>
                    ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Pénznem">
                <PilotSelect
                  chevron
                  aria-label="Pénznem"
                  value={currency}
                  onChange={setCurrency}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Kiinduló sablon" />
            <div className="space-y-3 p-5">
              <p className="text-sm text-pilot-grey-600">
                A sablon csak kiindulópont: minden blokk külön módosítható az
                ajánlatban.
              </p>
              <PilotFormField label="Sablon">
                <PilotSelect
                  chevron
                  aria-label="Sablon"
                  value={templateId}
                  onChange={chooseTemplate}
                >
                  <option value="">Sablon nélkül</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
            </div>
          </PilotCard>
        </div>

        <PilotCard>
          <PilotCardHeader title="Indítási összefoglaló" />
          <div className="space-y-1 p-5">
            <PilotDataRow
              label="Partner"
              value={customer?.displayName ?? "—"}
            />
            <PilotDataRow
              label="Sablon"
              value={template?.name ?? "Sablon nélkül"}
            />
            <PilotDataRow
              label="Érvényesség"
              value={`${validityDays} nap · ${formatQuoteDay(dayAfter(validityDays))}`}
            />
            <PilotDataRow label="Pénznem" value={currency} />
            <PilotDataRow
              label="Készítő"
              value={session?.user.displayName ?? "—"}
            />
            <p className="pt-3 text-xs text-pilot-grey-600">
              Ezekkel az adatokkal jön létre a piszkozat. A létrehozás nem küld
              semmit az ügyfélnek.
            </p>
          </div>
        </PilotCard>
      </div>
    </PilotThemeRoot>
  );
}
