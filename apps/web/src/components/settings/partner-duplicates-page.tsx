"use client";

import {
  Alert,
  EmptyState,
  PageHeader,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PartnerDuplicateCustomer,
  type PartnerDuplicateGroup,
  type PartnerDuplicateKeyKind,
  type PartnerDuplicatePair,
  type PartnerDuplicateReferences,
  type PartnerDuplicateResponse,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { partnerDuplicatesApi } from "@/lib/api/partner-duplicates";

/**
 * A PARTNER-DUPLIKÁTUMOK LISTÁJA (egy partnertörzs, 1. lépés). CSAK OLVAS: semmit nem vonunk össze innen, a bizonytalan
 * párokról Balázs ezekből a listákból dönt. A kulcs fajtája látszik, mert az dönti el, mennyire erős az egyezés.
 */
const KIND_LABEL: Record<PartnerDuplicateKeyKind, string> = {
  HU: "magyar adószám (alap)",
  HU4: "magyar adószám, 4-gyel kezdődő (csoportos adóalanyiság lehet)",
  EU: "közösségi adószám",
};

const REFERENCE_LABELS: [keyof PartnerDuplicateReferences, string][] = [
  ["invoices", "számla"],
  ["salesOrders", "rendelés"],
  ["contracts", "szerződés"],
  ["worksheets", "munkalap"],
  ["quotes", "árajánlat"],
  ["serviceJobs", "szerviz"],
];

export function referenceSummary(refs: PartnerDuplicateReferences): string {
  const parts = REFERENCE_LABELS.filter(([key]) => refs[key] > 0).map(
    ([key, label]) => `${refs[key]} ${label}`,
  );
  return parts.length ? parts.join(", ") : "nincs hivatkozás";
}

function CustomerLine({ customer }: { customer: PartnerDuplicateCustomer }) {
  return (
    <li
      data-testid="duplicate-customer"
      className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <span className="font-semibold text-pilot-grey-900">
          {customer.displayName}
        </span>
        {customer.companyName &&
        customer.companyName !== customer.displayName ? (
          <span className="block text-xs text-pilot-grey-500">
            {customer.companyName}
          </span>
        ) : null}
        <span className="block font-mono text-xs text-pilot-grey-600">
          {customer.customerNumber}
          {customer.taxNumber ? ` · ${customer.taxNumber}` : ""}
          {customer.euTaxNumber ? ` · ${customer.euTaxNumber}` : ""}
        </span>
        <span className="block text-xs text-pilot-grey-500">
          {referenceSummary(customer.references)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {customer.partnerMirror ? (
          <PilotBadge variant="blue">partner vevő-tükre</PilotBadge>
        ) : null}
        {customer.fromUnas ? (
          <PilotBadge variant="grey">UNAS</PilotBadge>
        ) : null}
      </div>
    </li>
  );
}

function GroupCard({ group }: { group: PartnerDuplicateGroup }) {
  return (
    <div data-testid="duplicate-group">
      <PilotCard>
        <PilotCardHeader title={group.key} />
        <div className="px-5 py-3">
          <p className="text-xs text-pilot-grey-600">
            {KIND_LABEL[group.kind]}, {group.customers.length} vevő
          </p>
          <ul className="divide-y divide-pilot-grey-100">
            {group.customers.map((customer) => (
              <CustomerLine key={customer.id} customer={customer} />
            ))}
          </ul>
        </div>
      </PilotCard>
    </div>
  );
}

function PairCard({ pair }: { pair: PartnerDuplicatePair }) {
  return (
    <div data-testid="duplicate-pair">
      <PilotCard>
        <PilotCardHeader title={pair.key} />
        <div className="px-5 py-3">
          <p className="text-xs text-pilot-grey-600">{KIND_LABEL[pair.kind]}</p>
          <p className="py-2 text-sm">
            <PilotBadge variant="amber">szállító</PilotBadge>{" "}
            <span className="font-semibold text-pilot-grey-900">
              {pair.supplier.name}
            </span>{" "}
            <span className="font-mono text-xs text-pilot-grey-600">
              {pair.supplier.code}
              {pair.supplier.country ? ` · ${pair.supplier.country}` : ""}
            </span>
          </p>
          <ul>
            <CustomerLine customer={pair.customer} />
          </ul>
        </div>
      </PilotCard>
    </div>
  );
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div>
        <h2 className="text-lg font-semibold text-pilot-grey-900">
          {title} ({count})
        </h2>
        <p className="text-sm text-pilot-grey-600">{description}</p>
      </div>
      {count ? (
        children
      ) : (
        <EmptyState
          title="Nincs találat"
          description="Ebben a listában ma nincs tétel."
        />
      )}
    </section>
  );
}

export function PartnerDuplicatesPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = session
    ? hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE)
    : false;
  const [data, setData] = useState<PartnerDuplicateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await partnerDuplicatesApi.report(token, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A duplikátum-lista nem tölthető be.",
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
        title="Nincs hozzáférésed a partner-duplikátumokhoz"
        description="settings.manage jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner-duplikátumok"
        description="Ugyanaz a cég több helyen: vevőként, szállítóként vagy webshopos vásárlóként. A lista csak olvasható, innen semmi nem vonódik össze."
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
        <div aria-label="Lista betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <div data-testid="duplicate-summary">
            <PilotCard className="p-4">
              <p className="text-sm text-pilot-grey-700">
                Webshopos (UNAS) vevő: {data.unas.total}, ebből adószám nélkül:{" "}
                {data.unas.withoutTaxNumber}. Mérve:{" "}
                {new Date(data.generatedAt).toLocaleString("hu-HU")}.
              </p>
            </PilotCard>
          </div>
          <Section
            title="Egyező vevők"
            description="Azonos magyar adószám-alap vagy azonos közösségi adószám: ugyanaz a cég, ha nem tévedés az adat."
            count={data.strong.length}
          >
            <div className="space-y-3">
              {data.strong.map((group) => (
                <GroupCard key={`${group.kind}:${group.key}`} group={group} />
              ))}
            </div>
          </Section>
          <Section
            title="Szállító és vevő összekötés nélkül"
            description="Ugyanaz az adószám egy szállítónál és egy vevőnél, de a kettő nincs összekötve."
            count={data.unlinked.length}
          >
            <div className="space-y-3">
              {data.unlinked.map((pair) => (
                <PairCard
                  key={`${pair.kind}:${pair.key}:${pair.supplier.id}:${pair.customer.id}`}
                  pair={pair}
                />
              ))}
            </div>
          </Section>
          <Section
            title="Csoportos adóalanyiság lehet"
            description="A 4-gyel kezdődő magyar adószám-alap több tagot is jelölhet: itt csak lista, emberi döntés kell."
            count={data.weakGroupTax.length}
          >
            <div className="space-y-3">
              {data.weakGroupTax.map((group) => (
                <GroupCard key={`${group.kind}:${group.key}`} group={group} />
              ))}
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
