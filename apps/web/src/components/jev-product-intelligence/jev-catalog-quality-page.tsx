"use client";

import { Alert, PilotPageHeader } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  servedNavigationFeatures,
} from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";

import { JevDisabledAction } from "./jev-decision-action";
import {
  catalogQueueState,
  CATALOG_QUEUE_MESSAGE,
} from "./jev-catalog-quality";
import type { QueueFilter } from "./jev-presentation";
import { JevQualityFilters, JevQualityQueueTable } from "./jev-quality-queue";

/**
 * KATALÓGUS ADATMINŐSÉG: THE CATALOGUE DATA-QUALITY VIEW (Figma 394:316,
 * `/products/adatminoseg`, JEV phase 5, discovery §10 and answer 6).
 *
 * The filters (Összes, Kritikus, Ütközés, Hiányzó adat, Javaslat,
 * Ellenőrzött) over an EMPTY queue: no run is stored anywhere, and no queue
 * endpoint exists (§11/2 is documented, not authorized), so there are no
 * rows to show and none are invented. The empty table says why, in words:
 * the server's switch is off, or it is on but there is nothing stored yet.
 * Never "nothing to check", which would read as a clean catalogue.
 *
 * Whether the switch is on comes from the menu the server served with the
 * session (`servedNavigationFeatures`); the browser reads no variable.
 *
 * Disabled, with the reason in words: Új ellenőrzés indítása, Export. Left
 * out until designed and backed (§9.5): the KPI cards, and "Összes
 * megtekintése" with a catalogue-wide total. Nothing on this page writes or
 * calls a provider.
 */
export function JevCatalogQualityPage() {
  const { session } = useAuth();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékekhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );

  const state = catalogQueueState(
    servedNavigationFeatures(session?.navigation),
  );

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
              reason="Ellenőrzés indítása még nincs engedélyezve."
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
      <JevQualityQueueTable
        rows={[]}
        filter={filter}
        now={new Date()}
        hrefFor={() => "/products"}
        emptyMessage={CATALOG_QUEUE_MESSAGE[state]}
      />
    </PilotThemeRoot>
  );
}
