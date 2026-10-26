"use client";

import {
  SettingsAreaGrid,
  WEBSHOP_SETTINGS_AREAS,
} from "./settings-overview-page";

/**
 * A WEBSHOP BEÁLLÍTÁSOK GYŰJTŐOLDALA (/webshop/beallitasok; Balázs, 2026-10-26
 * 13:05 UTC, msg 1564263673932026020; acrobot döntése): minden webshop-
 * beállítás egy helyen, a Beállítások áttekintő kártya-stílusában, új Figma
 * nélkül. Minden kártya a saját jogát és kapcsolóját kéri; amit a néző nem ér
 * el, az nem is látszik.
 */
export function WebshopSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dusk-900">
          Webshop beállítások
        </h1>
        <p className="mt-1 text-sm text-dusk-600">
          A webshop kapcsolatai, szinkronja, levelei és kezdőlapja egy helyen.
        </p>
      </div>
      <SettingsAreaGrid areas={WEBSHOP_SETTINGS_AREAS} />
    </div>
  );
}
