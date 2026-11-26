"use client";

import {
  Alert,
  PilotButton,
  PilotField,
  PilotFieldPair,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
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

  const ready = Boolean(customer && title.trim());
  // why the create button is pale, said out loud beside it (the shared form row's "Hiányzik: ..."): a tooltip is never seen
  const missing = [
    customer ? null : "Partner (válaszd ki a találatok közül)",
    title.trim() ? null : "Ajánlat címe",
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
      />

      {/*
        ON THE SHARED FORM SCAFFOLD (Picasso 3.7, card f0b70dbd): the cards in the 760 px column, the required and optional marks,
        "what happens next" on the right, and the action row at the form's end. The old right column ("Indítási összefoglaló")
        repeated the fields; the one fact it added, the validity's last day, now stands under the validity field.
      */}
      <PilotFormLayout
        top={
          error ? (
            <Alert variant="danger" title="Hiba történt" description={error} />
          ) : null
        }
        afterText="Ezekkel az adatokkal jön létre a piszkozat, és megnyílik az ajánlatszerkesztő. A létrehozás nem küld semmit az ügyfélnek."
        actions={
          <PilotFormActions
            missing={missing}
            busy={saving}
            submitLabel="Ajánlat létrehozása"
            busyLabel="Létrehozás…"
            onCancel={() => router.push(QUOTES_PATH)}
            onSubmit={() => void submit()}
          />
        }
      >
        <PilotFormCard title="Ajánlat alapadatai">
          <PilotField label="Partner" requirement="required">
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-pilot-grey-200 px-3 py-2">
                <span className="font-semibold">{customer.displayName}</span>
                <PilotButton variant="ghost" onClick={() => setCustomer(null)}>
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
          </PilotField>
          <PilotField label="Ajánlat címe" requirement="required">
            <PilotInput
              aria-label="Ajánlat címe"
              value={title}
              onChange={setTitle}
            />
          </PilotField>
          <PilotFieldPair>
            <PilotField
              label="Érvényesség"
              requirement="optional"
              help={`Lejár: ${formatQuoteDay(dayAfter(validityDays))}`}
            >
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
            </PilotField>
            <PilotField label="Pénznem" requirement="optional">
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
            </PilotField>
          </PilotFieldPair>
        </PilotFormCard>

        <PilotFormCard title="Kiinduló sablon">
          <PilotField
            label="Sablon"
            requirement="optional"
            help="A sablon csak kiindulópont: minden blokk külön módosítható az ajánlatban."
          >
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
          </PilotField>
        </PilotFormCard>
      </PilotFormLayout>
    </PilotThemeRoot>
  );
}
