"use client";

import {
  Alert,
  Button,
  Icon,
  PilotButton,
  PilotInput,
  PilotSection,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  INCOMING_BANK_MATCH_LABELS,
  INCOMING_READING_FIELD_LABELS,
  INCOMING_READING_REQUIRED,
  INCOMING_READING_SOURCE_LABELS,
  INCOMING_REVIEW_LABELS,
  PERMISSIONS,
  type IncomingDocumentReview,
  type IncomingReadingField,
  type IncomingReadingValues,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney } from "./billing-editor-state";

/** A csak postafiókos sor ellenőrző lapja; az azonosító a lista soráé (`mailbox:<id>`). */
export const incomingReviewHref = (id: string) =>
  `${BILLING_LIST_PATH}/bejovo/ellenorzes/${encodeURIComponent(id)}`;

type Form = Record<IncomingReadingField, string>;

const GROUPS: { title: string; fields: IncomingReadingField[] }[] = [
  {
    title: "Szállító",
    fields: ["supplierName", "supplierTaxNumber", "supplierEuTaxNumber"],
  },
  {
    title: "Bizonylat",
    fields: [
      "documentNumber",
      "issueDate",
      "fulfillmentDate",
      "dueDate",
      "currency",
    ],
  },
  { title: "Összegek", fields: ["netAmount", "vatAmount", "grossAmount"] },
];

const DATE_FIELDS = new Set<IncomingReadingField>([
  "issueDate",
  "fulfillmentDate",
  "dueDate",
]);
const AMOUNT_FIELDS = new Set<IncomingReadingField>([
  "netAmount",
  "vatAmount",
  "grossAmount",
]);
const REQUIRED = new Set<IncomingReadingField>(INCOMING_READING_REQUIRED);

const toForm = (values: IncomingReadingValues): Form =>
  Object.fromEntries(
    Object.entries(values).map(([field, value]) => [field, value ?? ""]),
  ) as Form;

/** Az üres mező `null`: a szerver így tudja, hogy nincs érték. */
const toValues = (form: Form): IncomingReadingValues =>
  Object.fromEntries(
    Object.entries(form).map(([field, value]) => [
      field,
      value.trim() === "" ? null : value.trim(),
    ]),
  ) as unknown as IncomingReadingValues;

/**
 * A POSTAFIÓKOS (KÜLFÖLDI) SZÁMLA ELLENŐRZÉSE (kártya e4c3b0fb). A PDF-ből
 * kinyert mezők a forrásukkal; a kezelő javít, ment, és jóváhagy. A
 * könyvelőhöz csak a jóváhagyott szám megy, ezért a jóváhagyásig a sor
 * „Ellenőrizendő”. Írni a Pénzügy írási joga (`finance.manage`) enged;
 * nélküle a lap csak olvasható.
 */
export function BillingIncomingReviewPage({ itemId }: { itemId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  // UGYANAZ A KULCS, AMIT A VÉGPONT KÉR: `finance.manage`, nem `billing.create`
  // (az a kimenő számláé, és az értékesítő is megkapja, 2026-10-08).
  const canEdit = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [review, setReview] = useState<IncomingDocumentReview | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = (next: IncomingDocumentReview) => {
    setReview(next);
    setForm(toForm(next.values));
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        accept(await billingDocumentsApi.incomingReview(token, itemId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A számla nem tölthető be.",
          );
      }
    },
    [canView, itemId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (kind: "save" | "approve") => {
    if (!form) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const values = toValues(form);
      accept(
        kind === "save"
          ? await billingDocumentsApi.saveIncomingReview(token, itemId, values)
          : await billingDocumentsApi.approveIncomingReview(
              token,
              itemId,
              values,
            ),
      );
      setNotice(
        kind === "save"
          ? "A javítás elmentve. A számla továbbra is ellenőrizendő."
          : "Jóváhagyva. A számla adata mostantól a könyvelői csomagba is bekerül.",
      );
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async () => {
    setActionError(null);
    try {
      const blob = await billingDocumentsApi.incomingPdf(token, itemId);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a számlázáshoz"
        description="billing.view jogosultság szükséges."
      />
    );
  if (error)
    return (
      <Alert
        variant="danger"
        title="A számla nem tölthető be"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );
  if (!review || !form)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  const verified = review.state === "VERIFIED";
  const editable = canEdit && !verified;
  const item = review.item;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <Link
        href={`${BILLING_LIST_PATH}?nezet=bejovo`}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a listához
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-pilot-accent-warm-text">
            Bejövő számla · Postafiókból
          </p>
          <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
            {review.values.documentNumber ?? item.documentNumber}
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-600">
            {review.values.supplierName ??
              (item.supplierName || "(név nélkül)")}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              verified
                ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                : "bg-pilot-accent-warm-soft text-pilot-accent-warm-text"
            }`}
          >
            {INCOMING_REVIEW_LABELS[review.state]}
          </span>
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() => void openPdf()}
          >
            PDF megnyitása
          </PilotButton>
        </div>
      </header>

      {review.warnings.length ? (
        <Alert
          title="Ellenőrizd ezeket"
          description={review.warnings.join("\n")}
        />
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          title="Nem sikerült"
          description={actionError}
        />
      ) : null}
      {notice ? <Alert title={notice} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {GROUPS.map((group) => (
            <PilotSection
              key={group.title}
              title={group.title}
              subtitle={
                group.title === "Összegek"
                  ? `A számla devizájában. A nettó és az ÁFA együtt adja ki a bruttót.`
                  : undefined
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {group.fields.map((field) => {
                  const label = `${INCOMING_READING_FIELD_LABELS[field]}${
                    REQUIRED.has(field) ? " *" : ""
                  }`;
                  const source = review.sources[field];
                  return (
                    <label key={field} className="flex flex-col gap-1 text-sm">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-pilot-grey-800">
                          {label}
                        </span>
                        <span className="text-xs text-pilot-grey-500">
                          {source
                            ? INCOMING_READING_SOURCE_LABELS[source]
                            : "nincs adat"}
                        </span>
                      </span>
                      <PilotInput
                        aria-label={INCOMING_READING_FIELD_LABELS[field]}
                        type={DATE_FIELDS.has(field) ? "date" : "text"}
                        inputMode={
                          AMOUNT_FIELDS.has(field) ? "decimal" : undefined
                        }
                        value={form[field]}
                        readOnly={!editable}
                        onChange={(value) =>
                          setForm((current) =>
                            current ? { ...current, [field]: value } : current,
                          )
                        }
                        className="h-10"
                      />
                    </label>
                  );
                })}
              </div>
            </PilotSection>
          ))}
        </div>

        <aside className="flex flex-col gap-6">
          <PilotSection
            title="Jóváhagyás"
            subtitle="A könyvelőhöz csak jóváhagyott adat megy."
          >
            {verified ? (
              <p className="text-sm text-pilot-grey-700">
                Ez a számla ellenőrizve, jóváhagyva. A listán rendes bejövő
                számlaként áll, „Postafiókból” jelöléssel.
              </p>
            ) : editable ? (
              <div className="flex flex-col gap-2">
                <PilotButton
                  size="regular"
                  onClick={() => void run("approve")}
                  disabled={busy}
                >
                  Jóváhagyás
                </PilotButton>
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={() => void run("save")}
                  disabled={busy}
                >
                  Mentés jóváhagyás nélkül
                </PilotButton>
                <p className="text-xs text-pilot-grey-500">
                  A csillagos mezők kellenek a jóváhagyáshoz.
                </p>
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-600">
                A jóváhagyáshoz pénzügyi írási jog (finance.manage) kell.
              </p>
            )}
            {!review.hasText ? (
              <p className="mt-3 text-xs text-pilot-grey-500">
                A PDF-nek nincs szövegrétege (szkennelt): a mezőket a PDF
                alapján kézzel kell kitölteni.
              </p>
            ) : null}
          </PilotSection>

          <PilotSection
            title="Banki párosítás"
            subtitle="A Hiányzó számlák párosítása szerint."
          >
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {INCOMING_BANK_MATCH_LABELS[item.bankMatch.state]}
              </p>
              <ul className="divide-y divide-pilot-grey-100">
                {item.bankMatch.debits.map((debit, index) => (
                  <li
                    key={`${index}-${debit.bookingDate}`}
                    className="flex justify-between gap-3 py-2"
                  >
                    <span>Terhelés {formatDay(debit.bookingDate)}</span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(debit.amount, debit.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </PilotSection>
        </aside>
      </div>
    </PilotThemeRoot>
  );
}
