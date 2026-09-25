"use client";

import { useMemo, useState } from "react";
import type { ReefChemistryElevationResult } from "@acropora/aquarium-calc";
import { Icon } from "./icon";
import {
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "./pilot-ui";

/**
 * EGY VÍZKEZELÉSI KALKULÁTOR KÁRTYA -- ÖNÁLLÓ, JOGOSULTSÁGTÓL FÜGGETLEN.
 *
 * Balázs kérése (2026-09-25, a "Kalkulátorok" kör közben, acrobot
 * közvetítésével): "gondoljunk mindenre, amit építünk, mint ami egyszer a
 * nyilvánosság elé is kerülhet" -- a Partner Portál egyszer ügyfeleknek
 * közvetlenül is megnyílhat, és egy hasonló kalkulátor a "Reef Club"
 * nevű, tervezett felületre is kell majd. EZÉRT ez a komponens NEM hív
 * `useAuth()`-t, NEM ellenőriz jogosultságot, és NEM tud semmit ARRÓL A
 * FELÜLETRŐL, AHONNAN HÍVJÁK -- csak a `@acropora/aquarium-calc` (nulla
 * futásidejű függőségű, megosztott csomag) képletét hívja, amit a hívó ad
 * át `compute` propként. Az OLDAL (ami MÁR felület-specifikus és MÁR
 * jogosultsághoz kötött, ld. `apps/partner/.../calculators-page.tsx` és
 * az `apps/web` párja) rakja össze ezt a kártyát a saját, hatókörű
 * akvárium-listájával -- a kártya ezt a listát is csak kész, egyszerű
 * objektum-tömbként kapja, nem saját maga kérdezi le.
 *
 * === EZÉRT ÁLL EBBEN A CSOMAGBAN, NEM AZ APPS/PARTNER ALATT ===
 *
 * Eredetileg `apps/partner` alatt épült (a Kalkulátorok kör első fele), de
 * még ugyanazon a napon `apps/web` is átvette -- pontosan az a fajta
 * duplikáció, amit Balázs fenti kérése el akar kerülni. Mivel a komponens
 * MÁR csak `@acropora/aquarium-calc`-ot és a csomag saját pilot-családját
 * hívta (soha nem ismerte a portál API-ját), az áthelyezés a
 * `packages/ui`-ba nem igényelt szétszálazást -- csak az import-utak
 * lettek relatívak.
 *
 * === AZ AKVÁRIUM-VÁLASZTÓ OPCIONÁLIS, ÉS A LITER-MEZŐ MINDIG FELÜLÍRHATÓ ===
 *
 * Balázs kifejezett kérése: "a partnernel csak azt az akvariumot tudja
 * kivalasztani ami hozza van csatolva a felhasznalohoz" -- ez a SZŰRÉS a
 * hívó (`aquariums` prop) dolga, nem ezé a kártyáé. Ha `aquariums` üres
 * tömb, a választó egyáltalán nem jelenik meg, és a Víztérfogat mező
 * kézzel töltendő -- ez a jövőbeli, akvárium-lista nélküli nyilvános
 * felület esete is egyben.
 */

export interface CalculatorAquariumOption {
  id: string;
  name: string;
  systemVolumeLiters?: number;
}

export interface CalculatorProductOption {
  value: string;
  label: string;
}

export interface CalculatorComputeInput {
  volumeLiters: number;
  current: number;
  target: number;
  product: string;
}

export interface CalculatorSuggestedCurrent {
  value: number;
  measuredAt: string;
}

export interface CalculatorCardProps {
  title: string;
  currentLabel: string;
  targetLabel: string;
  productLabel: string;
  productOptions: readonly CalculatorProductOption[];
  resultUnit: string;
  compute: (input: CalculatorComputeInput) => ReefChemistryElevationResult;
  /** Üres tömb esetén a választó nem jelenik meg -- ld. a fájl fejlécét. */
  aquariums?: readonly CalculatorAquariumOption[];
  /**
   * A HÍVÓ (portál-specifikus, `partnerApi`-t ismerő oldal) ADJA ÁT -- a
   * kártya csak jelzi, hogy melyik akváriumot választották, a legutóbbi
   * mérés lekérdezése (és a "javasolt érték" megjelenítése) a hívó dolga
   * a `suggestedCurrent` prop visszaadásával.
   */
  onSelectAquarium?: (aquariumId: string) => void;
  suggestedCurrent?: CalculatorSuggestedCurrent | null;
}

const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const resultFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 1,
});

export function CalculatorCard({
  title,
  currentLabel,
  targetLabel,
  productLabel,
  productOptions,
  resultUnit,
  compute,
  aquariums = [],
  onSelectAquarium,
  suggestedCurrent,
}: CalculatorCardProps) {
  const [aquariumId, setAquariumId] = useState("");
  const [volumeLiters, setVolumeLiters] = useState("");
  const [current, setCurrent] = useState("");
  const [target, setTarget] = useState("");
  const [product, setProduct] = useState(productOptions[0]?.value ?? "");

  const selectAquarium = (id: string) => {
    setAquariumId(id);
    const aquarium = aquariums.find((item) => item.id === id);
    /*
      A LITER-MEZŐ AZONNAL, ITT TÖLTŐDIK -- a kártya SAJÁT listájából, nem
      vár a hívóra. A hívónak csak a mérés-javaslathoz kell aszinkron
      lekérdezést indítania (ld. `onSelectAquarium`), a liter viszont már
      benne van az `aquariums` tömbben, amit a kártya amúgy is megkapott.
    */
    if (aquarium?.systemVolumeLiters !== undefined) {
      setVolumeLiters(String(aquarium.systemVolumeLiters));
    }
    onSelectAquarium?.(id);
  };

  const result = useMemo<ReefChemistryElevationResult | null>(() => {
    const volumeLitersNum = Number(volumeLiters);
    const currentNum = Number(current);
    const targetNum = Number(target);
    if (
      !volumeLiters.trim() ||
      !current.trim() ||
      !target.trim() ||
      !Number.isFinite(volumeLitersNum) ||
      !Number.isFinite(currentNum) ||
      !Number.isFinite(targetNum) ||
      volumeLitersNum <= 0
    ) {
      return null;
    }
    return compute({
      volumeLiters: volumeLitersNum,
      current: currentNum,
      target: targetNum,
      product,
    });
  }, [compute, current, product, target, volumeLiters]);

  return (
    <PilotCard className="flex flex-col">
      <PilotCardHeader title={title} />
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        {aquariums.length > 0 ? (
          <PilotFormField label="Akvárium">
            <PilotSelect value={aquariumId} onChange={selectAquarium}>
              <option value="">Nincs kiválasztva</option>
              {aquariums.map((aquarium) => (
                <option key={aquarium.id} value={aquarium.id}>
                  {aquarium.name}
                </option>
              ))}
            </PilotSelect>
          </PilotFormField>
        ) : null}

        <PilotFormField label="Víztérfogat (liter)">
          <PilotInput
            type="number"
            min={0}
            value={volumeLiters}
            onChange={setVolumeLiters}
            placeholder="pl. 1200"
          />
        </PilotFormField>

        <PilotFormField label={currentLabel}>
          <PilotInput
            type="number"
            value={current}
            onChange={setCurrent}
            placeholder="pl. 380"
          />
        </PilotFormField>
        {suggestedCurrent ? (
          <button
            type="button"
            onClick={() => setCurrent(String(suggestedCurrent.value))}
            className="-mt-2 inline-flex w-fit cursor-pointer items-center gap-1 text-xs font-medium text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800"
          >
            <Icon name="droplet" size={11} />
            Legutóbbi mérés: {resultFormatter.format(suggestedCurrent.value)} (
            {dateFormatter.format(new Date(suggestedCurrent.measuredAt))})
          </button>
        ) : null}

        <PilotFormField label={targetLabel}>
          <PilotInput
            type="number"
            value={target}
            onChange={setTarget}
            placeholder="pl. 420"
          />
        </PilotFormField>

        <PilotFormField label={productLabel}>
          <PilotSelect value={product} onChange={setProduct}>
            {productOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
      </div>

      <div className="border-t border-pilot-grey-100 px-5 py-4">
        {result === null ? (
          <div className="rounded-lg bg-pilot-grey-50 px-4 py-3 ring-1 ring-pilot-grey-100">
            <p className="mb-0.5 text-xs font-medium text-pilot-grey-400">
              Szükséges mennyiség
            </p>
            <p className="font-mono text-2xl font-semibold text-pilot-grey-300">
              —
            </p>
            <p className="text-xs text-pilot-grey-300">
              Töltsd ki a mezőket a számításhoz.
            </p>
          </div>
        ) : result.kind === "no-dosing-needed" ? (
          <div className="rounded-lg bg-pilot-grey-50 px-4 py-3 ring-1 ring-pilot-grey-100">
            <p className="mb-0.5 text-xs font-medium text-pilot-grey-400">
              Szükséges mennyiség
            </p>
            <p className="text-sm text-pilot-grey-600">
              A célérték nem magasabb a jelenlegi értéknél, nincs szükség
              adagolásra.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-pilot-aqua-50 px-4 py-3 ring-1 ring-pilot-aqua-100">
            <p className="mb-0.5 text-xs font-medium text-pilot-aqua-600">
              Szükséges mennyiség
            </p>
            <p className="font-mono text-2xl font-semibold text-pilot-aqua-700">
              {resultFormatter.format(result.grams)}
            </p>
            <p className="text-xs text-pilot-aqua-500">{resultUnit}</p>
          </div>
        )}
      </div>
    </PilotCard>
  );
}
