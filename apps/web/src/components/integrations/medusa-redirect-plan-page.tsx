"use client";

import {
  Alert,
  PageHeader,
  PilotBadge,
  Skeleton,
  type PilotBadgeVariant,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type MedusaRedirectPlanState,
  type MedusaRedirectPlanView,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { medusaRedirectPlanApi } from "@/lib/api/medusa-redirect-plan";

/**
 * A VETÍTÉS TERVÉNEK LAPJA (task t-20261118-vetites-oldal; a #2677 végpontja, acrobot 55559 javaslat 2). A `medusa-redirect --apply` a bolt TELJES átirányítás-listáját
 * cseréli; a lap megmutatja, mit változtatna: mi jönne újként, mi módosulna, és mi tűnne el a boltból. Csak olvas, indító művelet nincs: a vetítést
 * a szokott úton (egyszeri Coolify-feladat) indítja valaki, a lap azt mutatja meg, amit ott vakon kellett volna elfogadni.
 *
 * A példák az első húsz sor fajtánként; a darabszám a TELJES, és a lap kimondja, ha a lista csonka.
 */
export const REDIRECT_PLAN_STATE_LABELS: Record<
  MedusaRedirectPlanState,
  string
> = {
  "in-sync": "Megegyezik",
  "would-send": "Küldene",
  refused: "Elutasítva (lánc)",
};

const STATE_VARIANT: Record<MedusaRedirectPlanState, PilotBadgeVariant> = {
  "in-sync": "success",
  "would-send": "amber",
  refused: "danger",
};

const STATE_SENTENCE: Record<MedusaRedirectPlanState, string> = {
  "in-sync":
    "Az OS listája megegyezik a bolt listájával: a vetítés nem küldene semmit.",
  "would-send":
    "Eltérés van: az --apply a bolt TELJES listáját az OS listájára cserélné.",
  refused:
    "A listában lánc van (egy szabály célja egy másik szabály forrása): a vetítés NEM küld, amíg a lánc meg nem szűnik.",
};

function friendlyMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403)
    return "Ehhez a laphoz nincs jogosultságod.";
  if (cause instanceof ApiError && cause.status === 503)
    return "A webshop most nem érhető el, vagy nincs beállítva a hitelesítő adata: a terv nem olvasható.";
  return "A terv nem tölthető be.";
}

const shortHash = (hash: string) => hash.slice(0, 8);

function ShownOf({ count, shown }: { count: number; shown: number }) {
  if (shown >= count) return null;
  return (
    <span className="text-xs text-pilot-grey-500">
      {" "}
      (az első {shown} látszik)
    </span>
  );
}

function RowLine({
  source,
  destination,
  status,
}: {
  source: string;
  destination: string;
  status: number;
}) {
  return (
    <li className="flex flex-wrap gap-x-2 text-xs">
      <span className="break-all font-mono text-pilot-grey-900">{source}</span>
      <span aria-hidden="true">→</span>
      <span className="break-all font-mono text-pilot-grey-700">
        {destination}
      </span>
      <span className="text-pilot-grey-500">{status}</span>
    </li>
  );
}

export function MedusaRedirectPlanPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const allowed = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  const [plan, setPlan] = useState<MedusaRedirectPlanView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setPlan(null);
    setError(null);
    medusaRedirectPlanApi
      .get(token, controller.signal)
      .then(setPlan)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(friendlyMessage(cause));
      });
    return () => controller.abort();
  }, [allowed, token]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Átirányítások vetítése"
        description="Mit változtatna a következő vetítés a webshop átirányítás-listáján."
      />
      {!allowed ? (
        <Alert variant="danger" title="Ehhez a laphoz nincs jogosultságod." />
      ) : error ? (
        <Alert variant="danger" title={error} />
      ) : plan === null ? (
        <div aria-label="A terv betöltése">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <PlanBody plan={plan} />
      )}
    </div>
  );
}

function PlanBody({ plan }: { plan: MedusaRedirectPlanView }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <PilotBadge variant={STATE_VARIANT[plan.state]}>
            {REDIRECT_PLAN_STATE_LABELS[plan.state]}
          </PilotBadge>
          <p className="text-sm text-pilot-grey-700">
            {STATE_SENTENCE[plan.state]}
          </p>
        </div>
        {plan.refusedReason ? (
          <p className="break-all font-mono text-xs text-pilot-red-700">
            {plan.refusedReason}
          </p>
        ) : null}
        <p
          className="text-sm text-pilot-grey-700"
          data-testid="redirect-plan-counts"
        >
          Az OS listája: {plan.localCount} szabály (lenyomat{" "}
          {shortHash(plan.localHash)}) · a bolt listája: {plan.remoteCount}{" "}
          szabály (lenyomat {shortHash(plan.remoteHash)}) · változatlan:{" "}
          {plan.unchanged}
        </p>
        <p
          className="text-sm text-pilot-grey-700"
          data-testid="redirect-plan-retargeted"
        >
          Lap nélküli terméknél: {plan.retargeted.brand} sor a márkalapra,{" "}
          {plan.retargeted.gone} sor 410-zel; véglegesen megszűnt terméknél:{" "}
          {plan.retargeted.moved} sor a helyettesítőre vagy a kategóriára.
        </p>
      </div>

      {plan.added.count > 0 ? (
        <section
          data-testid="redirect-plan-added"
          className="space-y-2 rounded-lg border border-pilot-grey-200 p-4"
        >
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Új a boltban: {plan.added.count}
            <ShownOf
              count={plan.added.count}
              shown={plan.added.examples.length}
            />
          </h2>
          <ul className="space-y-1">
            {plan.added.examples.map((row) => (
              <RowLine key={row.source} {...row} />
            ))}
          </ul>
        </section>
      ) : null}

      {plan.changed.count > 0 ? (
        <section
          data-testid="redirect-plan-changed"
          className="space-y-2 rounded-lg border border-pilot-grey-200 p-4"
        >
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Módosul (más cél vagy státusz): {plan.changed.count}
            <ShownOf
              count={plan.changed.count}
              shown={plan.changed.examples.length}
            />
          </h2>
          <ul className="space-y-2">
            {plan.changed.examples.map((change) => (
              <li key={change.source} className="space-y-0.5 text-xs">
                <span className="block break-all font-mono text-pilot-grey-900">
                  {change.source}
                </span>
                <span className="block break-all font-mono text-pilot-grey-500">
                  {change.from.destination} ({change.from.status})
                </span>
                <span className="block break-all font-mono text-pilot-grey-700">
                  {change.to.destination} ({change.to.status})
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.removed.count > 0 ? (
        <section
          data-testid="redirect-plan-removed"
          className="space-y-2 rounded-lg border border-pilot-amber-100 bg-pilot-amber-50 p-4"
        >
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Csak a boltban van: {plan.removed.count}
            <ShownOf
              count={plan.removed.count}
              shown={plan.removed.examples.length}
            />
          </h2>
          <p className="text-xs text-pilot-amber-700">
            Ezek a teljes csere miatt eltűnnének a boltból.
          </p>
          <ul className="space-y-1">
            {plan.removed.examples.map((row) => (
              <RowLine key={row.source} {...row} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
