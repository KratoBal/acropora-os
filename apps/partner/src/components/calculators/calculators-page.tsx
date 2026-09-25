"use client";

import { useCallback, useEffect, useState } from "react";
import {
  alkalinityElevation,
  calciumElevation,
  magnesiumElevation,
} from "@acropora/aquarium-calc";
import {
  CalculatorCard,
  PilotThemeRoot,
  type CalculatorAquariumOption,
  type CalculatorSuggestedCurrent,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";

/**
 * A "KALKULÁTOROK" OLDAL -- EZ A PORTÁL-SPECIFIKUS, JOGOSULTSÁGHOZ KÖTÖTT
 * RÉTEG.
 *
 * A `CalculatorCard` maga (ld. a saját fejlécét) nem tud a portálról; EZ
 * az oldal az, ami `partnerApi`-t hív és a hívó saját, hozzá csatolt
 * akváriumaira szűkíti a választót -- a menüpont/útvonal-védelem a
 * `portal-shell.tsx` `canViewCalculators` ága, UGYANAZZAL a mintával, mint
 * az Akváriumok szekció.
 *
 * === AZ AKVÁRIUM-LISTA UJRAFELHASZNÁLT LEKÉRDEZÉS ===
 *
 * `partnerApi.aquariums()` -- UGYANAZ a hívás, amit az Akváriumok lista
 * használ, tehát a szerver oldali hatókör (csak a hívóhoz csatolt
 * helyszínek akváriumai) itt is ugyanúgy érvényes, új végpont vagy
 * duplikált jogosultsági logika nélkül. A `systemVolumeLiters` már ebben a
 * válaszban benne van (`AquariumSummary`), a liter-mező kitöltéséhez nem
 * kell külön lekérdezés.
 *
 * === A "LEGUTÓBBI MÉRÉS" JAVASLAT -- BEKERÜLT, MERT OLCSÓ VOLT ===
 *
 * Balázs engedélyezte, hogy ha ez "túl sokat nyitna", az első kör csak a
 * liter-résszel menjen. ITT BEKERÜLT: a `partnerApi.aquariumMeasurements`
 * végpont MÁR LÉTEZIK és MÁR HASZNÁLJA a vízérték-kártya (`aquarium-water-
 * values.tsx`) -- ez az oldal ugyanezt hívja meg, akvárium-választáskor,
 * és a kapott alkalmak közül a legutóbbit keresi ki, ami a kalkulátorhoz
 * tartozó paramétert (KALCIUM/MAGNEZIUM/KH) tartalmazza. Nincs új végpont,
 * nincs új jogosultsági szabály -- csak egy plusz hívás egy már meglévő
 * úton, és egy "javasolt érték" gomb a kártyán, amit a felhasználó
 * felülírhat. Ha ez a lekérdezés hibázik, a kártya egyszerűen nem mutat
 * javaslatot -- a kalkulátor kézzel beírt értékkel továbbra is működik.
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

export function CalculatorsPage() {
  const [aquariums, setAquariums] = useState<CalculatorAquariumOption[]>([]);
  const [suggested, setSuggested] = useState<
    Record<"KALCIUM" | "MAGNEZIUM" | "KH", CalculatorSuggestedCurrent | null>
  >({ KALCIUM: null, MAGNEZIUM: null, KH: null });

  useEffect(() => {
    void partnerApi
      .aquariums({ pageSize: 200 })
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
  }, []);

  const loadSuggestions = useCallback((aquariumId: string) => {
    if (!aquariumId) {
      setSuggested({ KALCIUM: null, MAGNEZIUM: null, KH: null });
      return;
    }
    void partnerApi
      .aquariumMeasurements(aquariumId)
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
              latest = { value: found.value, measuredAt: occasion.measuredAt };
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
      .catch(() => setSuggested({ KALCIUM: null, MAGNEZIUM: null, KH: null }));
  }, []);

  return (
    <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          AKVARISZTIKA
        </p>
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
