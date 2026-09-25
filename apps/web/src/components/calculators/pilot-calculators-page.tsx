"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  alkalinityElevation,
  calciumElevation,
  magnesiumElevation,
} from "@acropora/aquarium-calc";
import {
  Alert,
  CalculatorCard,
  PilotThemeRoot,
  type CalculatorAquariumOption,
  type CalculatorSuggestedCurrent,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useAuth } from "@/components/auth/auth-provider";
import { aquariumsApi } from "@/lib/api/aquariums";

/**
 * A "KALKULÁTOROK" OLDAL -- A BELSŐ WEB (`apps/web`) SAJÁT RÉTEGE.
 *
 * Ugyanaz a minta, mint `apps/partner/.../calculators-page.tsx`-nél, csak a
 * LÁTHATÓSÁGI SZABÁLY és az API-KLIENS más:
 *
 * - a portál a "hozzá csatolt akváriumok" szűrést a `partnerApi.aquariums()`
 *   szerver oldali hatóköréből kapja (a hívó identitása szab határt),
 * - itt a `aquariumsApi.list(token, query)` a BELSŐ, `aquariums.view`
 *   jogosultsághoz kötött lekérdezés -- ugyanaz, amit a Pilot Akvárium-lista
 *   (`pilot-aquarium-list-page.tsx`) használ. Ez SZÁNDÉKOSAN nem szűkebb: a
 *   belső felhasználó (aki látja az Akváriumok menüt) az összes akváriumot
 *   láthatja itt is, ugyanúgy, mint a listán.
 *
 * A `CalculatorCard` maga (ld. a saját fejlécét, `packages/ui`) nem tud sem
 * a portálról, sem a belső webről -- ez az oldal az, ami `useAuth`-ot és az
 * `aquariumsApi`-t hívja.
 */

const PRODUCT_OPTIONS = {
  calcium: [{ value: "CACL2_DIHYDRATE", label: "Kalcium-klorid-dihidrát" }],
  magnesiumChloride: {
    value: "MGCL2_HEXAHYDRATE",
    label: "Magnézium-klorid-hexahidrát",
  },
  magnesiumSulfate: {
    value: "MGSO4_HEPTAHYDRATE",
    label: "Magnézium-szulfát-heptahidrát",
  },
  alkalinity: [{ value: "NAHCO3", label: "Nátrium-hidrogén-karbonát" }],
} as const;

const MAGNESIUM_PRODUCT_OPTIONS = [
  PRODUCT_OPTIONS.magnesiumChloride,
  PRODUCT_OPTIONS.magnesiumSulfate,
] as const;

export function PilotCalculatorsPage() {
  const { session } = useAuth();
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_VIEW),
  );
  const token = session?.token ?? "";

  const [aquariums, setAquariums] = useState<CalculatorAquariumOption[]>([]);
  const [suggested, setSuggested] = useState<
    Record<"KALCIUM" | "MAGNEZIUM" | "KH", CalculatorSuggestedCurrent | null>
  >({ KALCIUM: null, MAGNEZIUM: null, KH: null });

  const listQuery = useMemo(() => {
    const q = new URLSearchParams();
    q.set("page", "1");
    q.set("pageSize", "200");
    return q;
  }, []);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void aquariumsApi
      .list(token, listQuery, controller.signal)
      .then((response) =>
        setAquariums(
          response.items.map((item) => ({
            id: item.id,
            name: item.name,
            systemVolumeLiters: item.systemVolumeLiters,
          })),
        ),
      )
      .catch(() => setAquariums([]));
    return () => controller.abort();
  }, [canView, listQuery, token]);

  const loadSuggestions = useCallback(
    (aquariumId: string) => {
      if (!aquariumId) {
        setSuggested({ KALCIUM: null, MAGNEZIUM: null, KH: null });
        return;
      }
      void aquariumsApi
        .listMeasurements(token, aquariumId)
        .then((response) => {
          const latestFor = (
            parameterCode: "KALCIUM" | "MAGNEZIUM" | "KH",
          ): CalculatorSuggestedCurrent | null => {
            let latest: CalculatorSuggestedCurrent | null = null;
            for (const occasion of response.occasions) {
              const found = occasion.values.find(
                (value) => value.parameterCode === parameterCode,
              );
              if (!found) continue;
              if (!latest || occasion.measuredAt > latest.measuredAt) {
                latest = {
                  value: found.value,
                  measuredAt: occasion.measuredAt,
                };
              }
            }
            return latest;
          };
          setSuggested({
            KALCIUM: latestFor("KALCIUM"),
            MAGNEZIUM: latestFor("MAGNEZIUM"),
            KH: latestFor("KH"),
          });
        })
        .catch(() =>
          setSuggested({ KALCIUM: null, MAGNEZIUM: null, KH: null }),
        );
    },
    [token],
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a kalkulátorokhoz"
        description="aquariums.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Kalkulátorok
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          Vízkezelési segédszámítások, tiszta vegyszerekre.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CalculatorCard
          title="Kalcium emelése"
          currentLabel="Jelenlegi érték (mg/l)"
          targetLabel="Célérték (mg/l)"
          productLabel="Készítmény"
          productOptions={PRODUCT_OPTIONS.calcium}
          resultUnit="g"
          aquariums={aquariums}
          onSelectAquarium={loadSuggestions}
          suggestedCurrent={suggested.KALCIUM}
          compute={({ volumeLiters, current, target }) =>
            calciumElevation({
              volumeLiters,
              currentMgL: current,
              targetMgL: target,
            })
          }
        />

        <CalculatorCard
          title="Magnézium emelése"
          currentLabel="Jelenlegi érték (mg/l)"
          targetLabel="Célérték (mg/l)"
          productLabel="Készítmény"
          productOptions={MAGNESIUM_PRODUCT_OPTIONS}
          resultUnit="g"
          aquariums={aquariums}
          onSelectAquarium={loadSuggestions}
          suggestedCurrent={suggested.MAGNEZIUM}
          compute={({ volumeLiters, current, target, product }) =>
            magnesiumElevation({
              volumeLiters,
              currentMgL: current,
              targetMgL: target,
              salt:
                product === PRODUCT_OPTIONS.magnesiumSulfate.value
                  ? "MGSO4_HEPTAHYDRATE"
                  : "MGCL2_HEXAHYDRATE",
            })
          }
        />

        <CalculatorCard
          title="KH emelése"
          currentLabel="Jelenlegi érték (dKH)"
          targetLabel="Célérték (dKH)"
          productLabel="Készítmény"
          productOptions={PRODUCT_OPTIONS.alkalinity}
          resultUnit="g"
          aquariums={aquariums}
          onSelectAquarium={loadSuggestions}
          suggestedCurrent={suggested.KH}
          compute={({ volumeLiters, current, target }) =>
            alkalinityElevation({
              volumeLiters,
              currentDkh: current,
              targetDkh: target,
            })
          }
        />
      </div>
    </PilotThemeRoot>
  );
}
