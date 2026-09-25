"use client";
import {
  aquariumMeasurementParametersFor,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementTarget,
  type WaterType,
} from "@acropora/types";

import { PilotCard, PilotCardHeader } from "@/components/pilot/pilot-ui";

/** A szerkesztő belső állapota: két SZÖVEGMEZŐ paraméterenként, üres string
 * "nincs megadva". Számmá csak beküldéskor alakul (`targetsPayload`),
 * ugyanúgy, mint a többi számmező az `PilotAquariumEditorPage`-en. */
export type TargetRangeDraft = Partial<
  Record<AquariumMeasurementParameterCode, { min: string; max: string }>
>;

/**
 * A "VÍZÉRTÉK CÉLTARTOMÁNYOK" KÁRTYA -- Balázs kérése (2026-09-25, Akváriumok
 * szál, 05:47 UTC): "amikor rögzítjük az akváriumot, akkor a jobb oldali
 * oszlopban jó lenne egy beállítási lehetőség a vízértékekre tól-ig, ami
 * alapján számolja az eltérést."
 *
 * ÚJ TENGERI AKVÁRIUMNÁL A KÓDBAN ÁLLÓ ALAPÉRTÉKEKKEL ELŐTÖLTVE, ÉDESVÍZINÉL
 * ÜRESEN -- lásd `AQUARIUM_MEASUREMENT_TARGET_RANGE` (`@acropora/types`)
 * fejlécét: az édesvízi tartományt SZÁNDÉKOSAN nem találtuk ki, mert egy
 * átvett tengeri szám itt TÉVES tanácsnak látszana, nem hiányzó adatnak. A
 * kezdőérték betöltése a szülő (`PilotAquariumEditorPage`) dolga -- ez a
 * komponens csak a MÁR ÖSSZEÁLLÍTOTT draft-ot rajzolja ki és szerkeszti.
 *
 * A MIN/MAX EGYMÁSTÓL FÜGGETLENÜL ELHAGYHATÓ SOROKÉNT -- egy csak alsó vagy
 * csak felső határt megadó sor is érvényes, lásd `AquariumMeasurementTarget`
 * fejlécét.
 */
export function PilotAquariumTargetRanges({
  waterType,
  draft,
  onChange,
}: {
  waterType?: WaterType;
  draft: TargetRangeDraft;
  onChange: (next: TargetRangeDraft) => void;
}) {
  const parameters = aquariumMeasurementParametersFor(waterType ?? null);

  function setBound(
    code: AquariumMeasurementParameterCode,
    bound: "min" | "max",
    value: string,
  ) {
    onChange({
      ...draft,
      [code]: { ...emptyRow(draft[code]), [bound]: value },
    });
  }

  return (
    <PilotCard>
      <PilotCardHeader title="Vízérték céltartományok" />
      <div className="flex flex-col divide-y divide-pilot-grey-50 px-5 py-2">
        {parameters.map((param) => {
          const row = emptyRow(draft[param.code]);
          const invalid = rangeInvalid(row);
          return (
            <div
              key={param.code}
              className="flex items-center gap-2 py-2 text-sm"
            >
              <span className="flex-1 text-pilot-grey-600">
                {param.label}
                <span className="ml-1 text-xs text-pilot-grey-300">
                  ({param.unit})
                </span>
              </span>
              <input
                type="number"
                step="any"
                placeholder="Tól"
                aria-label={`${param.label} alsó határa`}
                value={row.min}
                onChange={(event) =>
                  setBound(param.code, "min", event.target.value)
                }
                className={`w-20 rounded-md py-1 px-2 text-right text-xs ring-1 focus:outline-none focus:ring-2 ${
                  invalid
                    ? "ring-red-400 focus:ring-red-500"
                    : "ring-pilot-grey-200 focus:ring-pilot-aqua-500"
                }`}
              />
              <span className="text-pilot-grey-300">–</span>
              <input
                type="number"
                step="any"
                placeholder="Ig"
                aria-label={`${param.label} felső határa`}
                value={row.max}
                onChange={(event) =>
                  setBound(param.code, "max", event.target.value)
                }
                className={`w-20 rounded-md py-1 px-2 text-right text-xs ring-1 focus:outline-none focus:ring-2 ${
                  invalid
                    ? "ring-red-400 focus:ring-red-500"
                    : "ring-pilot-grey-200 focus:ring-pilot-aqua-500"
                }`}
              />
            </div>
          );
        })}
      </div>
      {hasInvalidRow(draft) ? (
        <p className="px-5 pb-4 text-xs text-red-600">
          Az alsó határ egyik paraméternél sem lehet nagyobb a felsőnél.
        </p>
      ) : null}
    </PilotCard>
  );
}

function emptyRow(row: { min: string; max: string } | undefined) {
  return row ?? { min: "", max: "" };
}

function rangeInvalid(row: { min: string; max: string }): boolean {
  if (row.min === "" || row.max === "") return false;
  const min = Number(row.min.replace(",", "."));
  const max = Number(row.max.replace(",", "."));
  return Number.isFinite(min) && Number.isFinite(max) && min > max;
}

/** BÁRMELYIK SOR ÉRVÉNYTELEN -- a "Mentés" gomb ez alapján tiltható le a
 * szülőn, hogy ne kelljen a szerver 400-ára várni egy nyilvánvaló hibánál. */
export function hasInvalidRow(draft: TargetRangeDraft): boolean {
  return Object.values(draft).some(
    (row) => row !== undefined && rangeInvalid(row),
  );
}

/** A DRAFT ÁTALAKÍTÁSA A KÜLDENDŐ TÖRZSRE -- csak azok a sorok kerülnek be,
 * amelyeknek legalább az egyik oldala ki van töltve; az üres sorokat NEM
 * küldjük (a szerver az ilyet törlésként értené, ha egyáltalán küldenénk). */
export function targetsPayload(
  draft: TargetRangeDraft,
): AquariumMeasurementTarget[] {
  const result: AquariumMeasurementTarget[] = [];
  for (const [code, row] of Object.entries(draft)) {
    if (!row) continue;
    const min = row.min === "" ? undefined : Number(row.min.replace(",", "."));
    const max = row.max === "" ? undefined : Number(row.max.replace(",", "."));
    if (min === undefined && max === undefined) continue;
    const target: AquariumMeasurementTarget = {
      parameterCode: code as AquariumMeasurementParameterCode,
    };
    if (min !== undefined) target.min = min;
    if (max !== undefined) target.max = max;
    result.push(target);
  }
  return result;
}

/** A KÓDBAN ÁLLÓ ALAPÉRTÉKEK DRAFT-TÁ ALAKÍTVA -- ÚJ, TENGERI AKVÁRIUM
 * ELSŐ ELŐTÖLTÉSÉHEZ. Lásd a fájl fejlécét: édesvízinél SOSEM hívjuk. */
export function draftFromDefaults(
  defaults: Partial<
    Record<AquariumMeasurementParameterCode, { min: number; max: number }>
  >,
): TargetRangeDraft {
  return Object.fromEntries(
    Object.entries(defaults).map(([code, range]) => [
      code,
      { min: String(range.min), max: String(range.max) },
    ]),
  );
}

/** A SZERVERTŐL KAPOTT, TÁROLT TARTOMÁNYOK DRAFT-TÁ ALAKÍTVA --
 * MEGLÉVŐ AKVÁRIUM BETÖLTÉSEKOR. */
export function draftFromTargets(
  targets: AquariumMeasurementTarget[],
): TargetRangeDraft {
  return Object.fromEntries(
    targets.map((target) => [
      target.parameterCode,
      {
        min: target.min !== undefined ? String(target.min) : "",
        max: target.max !== undefined ? String(target.max) : "",
      },
    ]),
  );
}
