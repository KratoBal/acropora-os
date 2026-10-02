"use client";

import { Alert, PilotPageHeader } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  servedNavigationFeatures,
  type ProductQualityQueueRow,
} from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotButton, PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { productApi } from "@/lib/api/products";

import { JevDisabledAction } from "./jev-decision-action";
import {
  catalogQueueState,
  CATALOG_QUEUE_MESSAGE,
  queueRowHref,
  type QueueLoad,
} from "./jev-catalog-quality";
import type { QueueFilter } from "./jev-presentation";
import { JevQualityFilters, JevQualityQueueTable } from "./jev-quality-queue";

/**
 * KATALÓGUS ADATMINŐSÉG: THE CATALOGUE DATA-QUALITY VIEW (Figma 394:316,
 * `/products/adatminoseg`; JEV phase 5, real data since PD-013).
 *
 * The filters (Összes, Kritikus, Ütközés, Hiányzó adat, Javaslat,
 * Ellenőrzött) ask the server (`GET /products/enrichment/queue`), which
 * filters and pages the fields of the latest stored shadow check of every
 * product; the browser never scans the catalogue. Every other state is a
 * sentence (`catalogQueueState`): unavailable for this user, an error, no
 * stored check yet, or an empty filter. Never "nothing to check" when nothing
 * was checked.
 *
 * Whether to ask at all comes from the menu the server served
 * (`servedNavigationFeatures`), so a user off the pilot list sends nothing.
 *
 * Disabled, with the reason in words: Új ellenőrzés indítása (a run is
 * started by hand on the server, `jev:enrich`), Export. Left out until
 * designed and backed (§9.5): the KPI cards. Nothing on this page writes.
 */
export function JevCatalogQualityPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [load, setLoad] = useState<QueueLoad>({ kind: "loading" });
  const [rows, setRows] = useState<ProductQualityQueueRow[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const features = useMemo(
    () => servedNavigationFeatures(session?.navigation),
    [session?.navigation],
  );
  const served = features.has("jev-product-enrichment");

  useEffect(() => {
    if (!canView || !served) return;
    let active = true;
    setLoad({ kind: "loading" });
    productApi
      .qualityQueue(token, filter, null)
      .then((page) => {
        if (!active) return;
        setLoad({ kind: "ready", page });
        setRows(page.rows);
      })
      .catch(() => active && setLoad({ kind: "error" }));
    return () => {
      active = false;
    };
    // `token` is read, not watched: the session object changes identity
  }, [canView, served, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékekhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );

  const state = catalogQueueState(features, load);
  const nextCursor = load.kind === "ready" ? load.page.nextCursor : null;

  const loadMore = () => {
    if (!nextCursor || load.kind !== "ready") return;
    setLoadingMore(true);
    productApi
      .qualityQueue(token, filter, nextCursor)
      .then((page) => {
        setLoad({ kind: "ready", page });
        setRows((current) => [...current, ...page.rows]);
      })
      .catch(() => setLoad({ kind: "error" }))
      .finally(() => setLoadingMore(false));
  };

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Termékek / JEV"
        title="Katalógus adatminőség"
        description="JEV · a termékadatok forrásalapú ellenőrzési sora"
        actions={
          <div className="flex flex-wrap items-start gap-3">
            <JevDisabledAction
              label="Új ellenőrzés indítása"
              canManage={canManage}
              reason="Az ellenőrzést egyelőre kézzel, a szerveren indítjuk."
            />
            <JevDisabledAction
              label="Export"
              canManage={canManage}
              reason="Az export még nincs engedélyezve."
            />
          </div>
        }
      />
      <JevQualityFilters value={filter} onChange={setFilter} />
      {state === "loading" ? (
        <div
          aria-busy="true"
          className="h-32 animate-pulse rounded-[14px] border border-pilot-grey-200 bg-pilot-grey-50"
        />
      ) : (
        <JevQualityQueueTable
          rows={state === "rows" ? rows : []}
          filter={filter}
          now={new Date()}
          hrefFor={queueRowHref}
          emptyMessage={
            state === "rows" ? undefined : CATALOG_QUEUE_MESSAGE[state]
          }
          emptyRole={state === "error" ? "alert" : "status"}
        />
      )}
      {state === "rows" && nextCursor ? (
        <PilotButton
          variant="secondary"
          size="regular"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Betöltés…" : "Továbbiak betöltése"}
        </PilotButton>
      ) : null}
    </PilotThemeRoot>
  );
}
