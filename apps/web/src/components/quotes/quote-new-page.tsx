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
import { quotesApi } from "@/lib/api/quotes";

import { dayAfter, errorText, formatQuoteDay } from "./quote-format";
import { QuotePartnerPicker } from "./quote-partner-picker";
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

  // the customer form is the person's own to open: it writes to the one customer register
  const canCreateCustomer = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE),
  );
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
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

  const template = templates.find((t) => t.id === templateId) ?? null;
  const ready = Boolean(customer && title.trim());
  // why the create button is grey, said out loud: a tooltip on a disabled button is never seen
  const missing = [
    customer ? null : "a partner (válaszd ki a találatok közül)",
    title.trim() ? null : "az ajánlat címe",
  ].filter((part): part is string => part !== null);

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
        eyebrow="Értékesítés / Árajánlatok"
        title="Új árajánlat"
        description="Az alapadatok és a kiinduló sablon megadása után nyílik meg az ajánlatszerkesztő."
        actions={
          <div className="flex flex-wrap gap-3">
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

      {ready ? null : (
        <p role="status" className="text-sm text-pilot-grey-600">
          Az ajánlat létrehozásához még hiányzik: {missing.join(" és ")}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <PilotCard>
            <PilotCardHeader title="Ajánlat alapadatai" />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
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
                      onClick={() => setCustomer(null)}
                    >
                      Csere
                    </PilotButton>
                  </div>
                ) : (
                  <QuotePartnerPicker
                    token={token}
                    canCreateCustomer={canCreateCustomer}
                    onSelect={setCustomer}
                  />
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
