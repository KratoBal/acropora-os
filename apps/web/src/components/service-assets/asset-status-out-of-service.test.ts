import { pilotBadgeVariantForTone } from "@acropora/ui";
import { assetStatusTone } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { assetStatusPilotVariant } from "./asset-labels";
import { TABS } from "./asset-list-page";

/**
 * AZ "UZEMEN KIVUL" ALLAPOT A BELSO FELULETEN (Balazs kerese, 2026-09-30).
 */
describe("Üzemen kívül a belső felületen", () => {
  /*
    A KET FELULET UGYANAZT A SZINT MUTATJA. A partner-portal a
    `pilotBadgeVariantForTone`-t hasznalja, a belso felulet a sajat
    `assetStatusPilotVariant`-jat. MI PIROSIT: ha a belso felulet a pirosat
    tovabbra is a szurke `default`-ra ejti, mig a portal pirosat mutat.
  */
  it("piros (danger) jelvényt kap, ugyanazt, mint a partner-portálon", () => {
    expect(assetStatusPilotVariant("OUT_OF_SERVICE")).toBe("danger");
    expect(pilotBadgeVariantForTone(assetStatusTone.OUT_OF_SERVICE)).toBe(
      "danger",
    );
  });

  it("saját fület kap, a Javítás alatt után", () => {
    const keys = TABS.map((tab) => tab.key);
    expect(keys.indexOf("OUT_OF_SERVICE")).toBe(keys.indexOf("IN_REPAIR") + 1);
    expect(TABS.find((tab) => tab.key === "OUT_OF_SERVICE")?.label).toBe(
      "Üzemen kívül",
    );
  });
});
