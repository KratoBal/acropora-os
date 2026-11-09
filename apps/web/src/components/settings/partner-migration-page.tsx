"use client";

import {
  Alert,
  EmptyState,
  PageHeader,
  PilotBadge,
  PilotButton,
  PilotCard,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PartnerMigrationAction,
  type PartnerMigrationCustomer,
  type PartnerMigrationPlan,
  type PartnerMigrationRow,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { partnerMigrationApi } from "@/lib/api/partner-migration";

import { PartnerMergeSection } from "./partner-merge-section";
import { PartnerMigrationRunSection } from "./partner-migration-run-section";

/**
 * A PARTNEREK ÁTVEZETÉSÉNEK TERVE (egy partnertörzs, egyszeri átvezetés). Minden partner
 * (beszállító, szerviz-partner) egyetlen vevő-törzs sor lesz, a szerep jelölésként rajta; ez a lista soronként megmondja, mi
 * történne, és mi alapján (az adószám párosít, a név nem). A lista maga CSAK OLVAS; az írás a lista alatti szakaszokból megy
 * (próba, lenyomat, megerősítés), Balázs jelenlétében.
 */
export const ACTION_LABEL: Record<PartnerMigrationAction, string> = {
  SKIP_OWN: "Kimarad: saját cég",
  MARK_ONLY: "Már van vevő-sora: csak a szerep-jelölés kerül rá",
  MERGE_CANDIDATES:
    "Van vevő-sora, de ugyanazon az adószámon további vevő-sorok is: összevonás kell",
  BIND_EXISTING: "Egy meglévő vevő-sorhoz kötjük",
  BIND_AMBIGUOUS: "Több meglévő vevő-sor is jelölt: Balázs dönti el, melyikhez",
  CREATE_NEW: "Új vevő-sor készül belőle",
};

const ACTION_TONE: Record<
  PartnerMigrationAction,
  "grey" | "teal" | "amber" | "blue"
> = {
  SKIP_OWN: "grey",
  MARK_ONLY: "teal",
  MERGE_CANDIDATES: "amber",
  BIND_EXISTING: "blue",
  BIND_AMBIGUOUS: "amber",
  CREATE_NEW: "blue",
};

const ROLE_LABEL = { SUPPLIER: "Beszállító", SERVICE: "Szerviz-partner" };

function CustomerLine({
  customer,
  label,
}: {
  customer: PartnerMigrationCustomer;
  label: string;
}) {
  return (
    <li
      className="py-1 text-xs text-pilot-grey-700"
      data-testid="migration-customer"
    >
      <span className="font-semibold text-pilot-grey-900">
        {customer.displayName}
      </span>{" "}
      <span className="font-mono">{customer.customerNumber}</span>
      {customer.taxNumber ? ` · ${customer.taxNumber}` : ""}
      {customer.euTaxNumber ? ` · ${customer.euTaxNumber}` : ""}
      {" · "}
      {customer.references
        ? `${customer.references} hivatkozás`
        : "nincs hivatkozás"}
      {customer.fromUnas ? " · UNAS" : ""}
      <span className="ml-2 text-pilot-grey-500">({label})</span>
    </li>
  );
}

function PartnerRow({ row }: { row: PartnerMigrationRow }) {
  return (
    <PilotCard>
      <div
        className="flex flex-col gap-3 px-5 py-4"
        data-testid="migration-row"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-pilot-grey-900">
              {row.name}
            </p>
            <p className="font-mono text-xs text-pilot-grey-600">
              {row.code}
              {row.taxNumber ? ` · ${row.taxNumber}` : " · nincs adószám"}
              {row.country ? ` · ${row.country}` : ""}
              {row.worksheetPartnerCode
                ? ` · szerviz-kód ${row.worksheetPartnerCode}`
                : ""}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.roles.map((role) => (
                <PilotBadge key={role} variant="grey">
                  {ROLE_LABEL[role]}
                </PilotBadge>
              ))}
              {row.isActive ? null : (
                <PilotBadge variant="amber">inaktív</PilotBadge>
              )}
            </div>
          </div>
          <PilotBadge variant={ACTION_TONE[row.action]}>
            {ACTION_LABEL[row.action]}
          </PilotBadge>
        </div>
        {row.linkedCustomer ||
        row.candidates.length ||
        row.nameCandidates.length ? (
          <ul className="divide-y divide-pilot-grey-100">
            {row.linkedCustomer ? (
              <CustomerLine
                customer={row.linkedCustomer}
                label="már kötött sor"
              />
            ) : null}
            {row.candidates.map((customer) => (
              <CustomerLine
                key={customer.id}
                customer={customer}
                label="ugyanazon az adószámon"
              />
            ))}
            {row.nameCandidates.map((customer) => (
              <CustomerLine
                key={customer.id}
                customer={customer}
                label="azonos nevű, csak tájékoztatás"
              />
            ))}
          </ul>
        ) : null}
        {row.notes.length ? (
          <ul className="list-disc pl-5 text-xs text-pilot-grey-600">
            {row.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </PilotCard>
  );
}

export function PartnerMigrationPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = session
    ? hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE)
    : false;
  const [data, setData] = useState<PartnerMigrationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await partnerMigrationApi.plan(token, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az átvezetés terve nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a partner-átvezetéshez"
        description="settings.manage jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner-átvezetés"
        description="Minden partner (beszállító, szerviz-partner) egyetlen vevő-törzs sor lesz, a szerep jelölésként rajta. A lista soronként megmondja, mi történne, és mi alapján (az adószám párosít, a név nem); alatta futtatható a próba, az átvezetés és a visszaállítás."
        actions={
          <PilotButton variant="secondary" onClick={() => void load()}>
            Frissítés
          </PilotButton>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      ) : null}
      {loading && !data ? (
        <div aria-label="Terv betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <div data-testid="migration-summary">
            <PilotCard className="p-4">
              <p className="text-sm text-pilot-grey-700">
                {data.total} partner. Műveletek:{" "}
                {Object.entries(data.byAction)
                  .map(
                    ([action, count]) =>
                      `${count} × ${ACTION_LABEL[action as PartnerMigrationAction]}`,
                  )
                  .join("; ") || "nincs"}
                .
              </p>
            </PilotCard>
          </div>
          <PartnerMigrationRunSection
            token={token}
            plan={data}
            onChanged={() => void load()}
          />
          <PartnerMergeSection
            token={token}
            plan={data}
            onChanged={() => void load()}
          />
          {data.rows.length ? (
            <div className="space-y-3">
              {data.rows.map((row) => (
                <PartnerRow key={row.supplierId} row={row} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nincs partner"
              description="A partner-táblában nincs sor."
            />
          )}
        </>
      ) : null}
    </div>
  );
}
