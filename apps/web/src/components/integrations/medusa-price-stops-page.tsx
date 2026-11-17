"use client";

import {
  Alert,
  EmptyState,
  PageHeader,
  PilotBadge,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type MedusaPriceStopsView,
  type MedusaPriceStopView,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { medusaPriceStopsApi } from "@/lib/api/medusa-price-stops";
import { formatDateTimeHu } from "@/lib/format/date";

import {
  priceStopKindHint,
  priceStopKindLabel,
} from "./medusa-price-stop-labels";

/**
 * AZ ÁR-MEGÁLLÁSOK TÁBLÁJA (task t-20261117-arstop-web; acrobot 55208, 55257).
 *
 * A vetítő ár-fele minden elbukott termékre eltárolja az okot, és a #2665 óta az emberi adat-állapot nem teszi FAILED-dé a kört: ez
 * a lap mondja meg, MELYIK termék árát kell kézzel rendezni. Csak olvas. A sorrendet a szerver adja (az emberre váró elöl, utána a
 * legújabb), a lap nem rendezi át.
 *
 * A cikkszám a termék VÁLTOZATAIN áll (egy termékhez több lehet), és ha a termék sora már nincs meg, a cikkszám üres, a sor mégis
 * látszik: egy eltűnt termék hivatkozása is megállás, amit valakinek látnia kell.
 */

function friendlyMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403)
    return "Ehhez a laphoz nincs jogosultságod.";
  return "Az ár-megállások listája nem tölthető be.";
}

function ProblemCell({ stop }: { stop: MedusaPriceStopView }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap gap-1">
        {stop.kinds.map((kind) => (
          <PilotBadge
            key={kind.kind}
            variant={kind.needsPerson ? "amber" : "grey"}
          >
            {priceStopKindLabel(kind.kind)}
          </PilotBadge>
        ))}
      </span>
      {stop.kinds
        .filter((kind) => kind.needsPerson)
        .map((kind) => priceStopKindHint(kind.kind))
        .filter((hint): hint is string => hint !== null)
        .map((hint) => (
          <span key={hint} className="text-xs text-pilot-grey-600">
            {hint}
          </span>
        ))}
      {stop.kinds.some((kind) => !kind.needsPerson) ? (
        <span className="text-xs text-pilot-grey-500">
          A szürke jelzésű hibát a vetítés magától újrapróbálja.
        </span>
      ) : null}
      {stop.reasonCut ? (
        <span className="text-xs text-pilot-grey-500">
          A tárolt ok csonka: az utolsó üzenet vége hiányozhat.
        </span>
      ) : null}
    </span>
  );
}

const COLUMNS: PilotTableColumn<MedusaPriceStopView>[] = [
  {
    id: "sku",
    header: "Cikkszám",
    width: "18%",
    cell: (stop) =>
      stop.skus.length > 0 ? (
        <span className="flex flex-col font-mono text-xs text-pilot-grey-900">
          {stop.skus.map((sku) => (
            <span key={sku}>{sku}</span>
          ))}
        </span>
      ) : (
        <span className="text-pilot-grey-500">nincs</span>
      ),
  },
  {
    id: "name",
    header: "Termék",
    width: "26%",
    cell: (stop) =>
      stop.name !== null ? (
        <span className="font-semibold text-pilot-grey-900">{stop.name}</span>
      ) : (
        <span className="text-pilot-grey-500">A termék sora már nincs meg</span>
      ),
  },
  {
    id: "problem",
    header: "Mi a gond",
    cell: (stop) => <ProblemCell stop={stop} />,
  },
  {
    id: "since",
    header: "Megállt",
    width: "14%",
    nowrap: true,
    cell: (stop) => formatDateTimeHu(stop.failedAt),
  },
];

export function MedusaPriceStopsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const allowed = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  const [view, setView] = useState<MedusaPriceStopsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setView(null);
    setError(null);
    medusaPriceStopsApi
      .get(token, controller.signal)
      .then(setView)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(friendlyMessage(cause));
      });
    return () => controller.abort();
  }, [allowed, token]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ár-megállások"
        description="Azok a termékek, amelyek ára nem megy ki a webshopba, és miért."
      />

      {!allowed ? (
        <Alert variant="danger" title="Ehhez a laphoz nincs jogosultságod." />
      ) : error ? (
        <Alert variant="danger" title={error} />
      ) : view === null ? (
        <Skeleton className="h-48 w-full" />
      ) : view.total === 0 ? (
        <EmptyState
          title="Nincs megállt termék"
          description="Minden árazható termék ára kiment a legutóbbi körben."
        />
      ) : (
        <div className="space-y-4">
          <p
            className="text-sm text-pilot-grey-700"
            data-testid="price-stops-summary"
          >
            {view.total} megállt termék, ebből {view.needingPerson} vár emberi
            döntésre.
          </p>
          {view.truncated ? (
            <Alert
              variant="info"
              title={`A lista csonka: ${view.stops.length} sor látszik a ${view.total}-ból, az emberi döntésre váró termékek elöl.`}
            />
          ) : null}
          <PilotDataTable
            columns={COLUMNS}
            rows={view.stops}
            rowKey={(stop) => stop.productId}
            minWidth={820}
          />
        </div>
      )}
    </div>
  );
}
