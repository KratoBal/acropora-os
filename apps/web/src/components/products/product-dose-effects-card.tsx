"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Input,
  PilotSection,
  Select,
  Textarea,
} from "@acropora/ui";
import {
  AQUARIUM_MEASUREMENT_PARAMETERS,
  type AquariumMeasurementParameterCode,
  aquariumMeasurementParameter,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  doseEffectApi,
  type DoseEffectDirection,
  type DoseEffectRefusal,
  type DoseEffectSuggestion,
  type DoseEffectView,
  type DoseUnit,
} from "@/lib/api/dose-effects";

/**
 * THE PRODUCT'S DOSE LIST (ReefClub plan v6.1, 6.2; slice 7): what one dose
 * unit of the product changes in 100 litres, per parameter, and whether the
 * row may feed the automatic recommendation.
 *
 * THE CARD SHOWS WHY A ROW IS NOT LIVE, not only that it is not: every
 * refusal the API names is written out (no second colleague yet, no daily
 * maximum, the JEV says otherwise, the product cannot be bought). A row
 * recorded by the viewer offers no "check" button: the check is a second
 * colleague's (the API refuses it too).
 *
 * The JEV's suggestion fills in the parameter, the direction and the source;
 * the numbers are always typed by the colleague (the JEV knows the direction,
 * not the amount).
 */
const REFUSAL_TEXT: Record<DoseEffectRefusal, string> = {
  ARCHIVED: "archiválva",
  NO_SOURCE: "nincs forrás",
  NOT_VERIFIED: "második kolléga még nem ellenőrizte",
  SAME_COLLEAGUE: "ugyanaz ellenőrizte, aki rögzítette",
  NO_MAX_DAILY: "hiányzik a gyártó napi legnagyobb adagja",
  JEV_DISAGREES: "a JEV nem ezt a hatást mondja a termékről",
  NOT_PURCHASABLE: "a termék nem vásárolható",
};
const UNIT_TEXT: Record<DoseUnit, string> = {
  ML: "ml",
  G: "g",
  CSEPP: "csepp",
};
const DIRECTION_TEXT: Record<DoseEffectDirection, string> = {
  EMEL: "emel",
  CSOKKENT: "csökkent",
};

export function parameterLabel(code: string): string {
  return (
    aquariumMeasurementParameter(code as AquariumMeasurementParameterCode)
      ?.label ?? code
  );
}

function parameterUnit(code: string): string {
  return (
    aquariumMeasurementParameter(code as AquariumMeasurementParameterCode)
      ?.unit ?? ""
  );
}

export function refusalText(refusal: DoseEffectRefusal): string {
  return REFUSAL_TEXT[refusal];
}

interface Draft {
  /** Set when editing: the row and the version the editor saw. */
  editing: { id: string; version: number } | null;
  parameterCode: string;
  direction: DoseEffectDirection;
  effectPer100L: string;
  doseUnit: DoseUnit;
  doseStep: string;
  maxDailyDosePer100L: string;
  effectHours: string;
  source: string;
}

const EMPTY_DRAFT: Draft = {
  editing: null,
  parameterCode: "KH",
  direction: "EMEL",
  effectPer100L: "",
  doseUnit: "ML",
  doseStep: "",
  maxDailyDosePer100L: "",
  effectHours: "",
  source: "",
};

/** "" is no value; a comma is a decimal point (Hungarian typing). */
function numberOf(text: string): number | undefined {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || Number.isNaN(value) ? undefined : value;
}

export function ProductDoseEffectsCard({
  token,
  productId,
  canManage,
  currentUserId,
}: {
  token: string;
  productId: string;
  canManage: boolean;
  currentUserId: string;
}) {
  const [rows, setRows] = useState<DoseEffectView[] | null>(null);
  const [suggestion, setSuggestion] = useState<DoseEffectSuggestion | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, suggested] = await Promise.all([
        doseEffectApi.forProduct(token, productId),
        doseEffectApi.suggestion(token, productId),
      ]);
      setRows(list.items);
      setSuggestion(suggested);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az adag-hatás sorok nem tölthetők be.",
      );
      setRows([]);
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setDraft(null);
      setArchiving(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!draft) return;
    const effectPer100L = numberOf(draft.effectPer100L);
    const doseStep = numberOf(draft.doseStep);
    if (effectPer100L === undefined || doseStep === undefined) {
      setError("A hatás és az adaglépés kötelező szám.");
      return;
    }
    const maxDaily = numberOf(draft.maxDailyDosePer100L);
    const hours = numberOf(draft.effectHours);
    void act(() =>
      draft.editing
        ? doseEffectApi.update(token, draft.editing.id, {
            expectedVersion: draft.editing.version,
            effectPer100L,
            doseUnit: draft.doseUnit,
            doseStep,
            maxDailyDosePer100L: maxDaily ?? null,
            effectHours: hours ?? null,
            source: draft.source,
          })
        : doseEffectApi.create(token, productId, {
            parameterCode: draft.parameterCode,
            direction: draft.direction,
            effectPer100L,
            doseUnit: draft.doseUnit,
            doseStep,
            ...(maxDaily !== undefined
              ? { maxDailyDosePer100L: maxDaily }
              : {}),
            ...(hours !== undefined ? { effectHours: hours } : {}),
            source: draft.source,
          }),
    );
  };

  const edit = (row: DoseEffectView) =>
    setDraft({
      editing: { id: row.id, version: row.version },
      parameterCode: row.parameterCode,
      direction: row.direction,
      effectPer100L: String(row.effectPer100L),
      doseUnit: row.doseUnit,
      doseStep: String(row.doseStep),
      maxDailyDosePer100L:
        row.maxDailyDosePer100L === null ? "" : String(row.maxDailyDosePer100L),
      effectHours: row.effectHours === null ? "" : String(row.effectHours),
      source: row.source,
    });

  const live = (rows ?? []).filter((row) => !row.archivedAt);

  return (
    <PilotSection
      title="Adag-hatás"
      subtitle="Mennyit változtat egy adagegység 100 liter vízben (a ReefClub adagajánlásához)"
      action={
        canManage && !draft && rows ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
          >
            Új sor
          </Button>
        ) : undefined
      }
      bodyClassName="space-y-3 px-5 py-5"
    >
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      {!rows ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : live.length === 0 && !draft ? (
        <p className="text-sm text-pilot-grey-500">
          Ehhez a termékhez még nincs adag-hatás sor.
        </p>
      ) : null}

      {live.map((row) => (
        <div
          key={row.id}
          data-testid={`dose-effect-${row.parameterCode}-${row.direction}`}
          className="space-y-1 rounded-lg border border-dusk-100 p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-dusk-900">
              {parameterLabel(row.parameterCode)}{" "}
              {DIRECTION_TEXT[row.direction]}
            </span>
            {row.usable ? (
              <Badge variant="success">Használható</Badge>
            ) : (
              <Badge variant="warning">Nem használható</Badge>
            )}
          </div>
          <p className="text-dusk-700">
            1 {UNIT_TEXT[row.doseUnit]} / 100 l: {row.effectPer100L}{" "}
            {parameterUnit(row.parameterCode)} · lépés {row.doseStep}{" "}
            {UNIT_TEXT[row.doseUnit]} · napi legfeljebb{" "}
            {row.maxDailyDosePer100L === null
              ? "nincs megadva"
              : `${row.maxDailyDosePer100L} ${UNIT_TEXT[row.doseUnit]} / 100 l`}{" "}
            · hatásidő {row.effectHours ?? 24} óra
          </p>
          <p className="break-words text-xs text-dusk-500">
            Forrás: {row.source}
          </p>
          <p className="text-xs text-dusk-500">
            {row.version}. változat · rögzítette {row.recordedBy?.name ?? "?"}
            {row.verifiedBy
              ? ` · ellenőrizte ${row.verifiedBy.name}`
              : " · még nincs ellenőrizve"}
            {row.jevStatus === "UNVERIFIED"
              ? " · a JEV-egyezés csak saját adaton áll"
              : ""}
          </p>
          {row.refusals.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-amber-700">
              {row.refusals.map((refusal) => (
                <li key={refusal}>{refusalText(refusal)}</li>
              ))}
            </ul>
          ) : null}
          {canManage && !draft ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {!row.verifiedBy && row.recordedBy?.id !== currentUserId ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      doseEffectApi.verify(token, row.id, row.version),
                    )
                  }
                >
                  Ellenőriztem
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => edit(row)}
              >
                Szerkesztés
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setArchiving(row.id)}
              >
                Archiválás
              </Button>
            </div>
          ) : null}
        </div>
      ))}

      {canManage && !draft && suggestion && suggestion.rows.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-dusk-50 p-3 text-sm">
          <p className="font-medium text-dusk-800">
            A JEV szerint a termék ezeket is mozgatja
            {suggestion.jev.status === "UNVERIFIED"
              ? " (csak saját adat alapján)"
              : ""}
            :
          </p>
          {suggestion.dosing ? (
            <p className="text-xs text-dusk-500">
              A JEV adagolási adata: {suggestion.dosing.value}
            </p>
          ) : null}
          {suggestion.rows.map((suggested) => (
            <div
              key={`${suggested.parameterCode}-${suggested.direction}`}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {parameterLabel(suggested.parameterCode)}{" "}
                {DIRECTION_TEXT[suggested.direction]}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...EMPTY_DRAFT,
                    parameterCode: suggested.parameterCode,
                    direction: suggested.direction,
                    source: suggested.source ?? "",
                  })
                }
              >
                Felvétel
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {draft ? (
        <div className="space-y-2 rounded-lg border border-dusk-200 p-3 text-sm">
          {draft.editing ? (
            <p className="text-xs text-amber-700">
              A mentés új változatot nyit, és a sort újra egy második kollégának
              kell ellenőriznie.
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Paraméter</span>
              <Select
                aria-label="Paraméter"
                value={draft.parameterCode}
                disabled={!!draft.editing}
                onChange={(event) =>
                  setDraft({ ...draft, parameterCode: event.target.value })
                }
              >
                {AQUARIUM_MEASUREMENT_PARAMETERS.map((parameter) => (
                  <option key={parameter.code} value={parameter.code}>
                    {parameter.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Irány</span>
              <Select
                aria-label="Irány"
                value={draft.direction}
                disabled={!!draft.editing}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    direction: event.target.value as DoseEffectDirection,
                  })
                }
              >
                <option value="EMEL">emel</option>
                <option value="CSOKKENT">csökkent</option>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">
                Hatás 100 literre, egy adagegység (
                {parameterUnit(draft.parameterCode)})
              </span>
              <Input
                aria-label="Hatás 100 literre"
                inputMode="decimal"
                value={draft.effectPer100L}
                onChange={(event) =>
                  setDraft({ ...draft, effectPer100L: event.target.value })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Adagegység</span>
              <Select
                aria-label="Adagegység"
                value={draft.doseUnit}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    doseUnit: event.target.value as DoseUnit,
                  })
                }
              >
                <option value="ML">ml</option>
                <option value="G">g</option>
                <option value="CSEPP">csepp</option>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">Legkisebb adaglépés</span>
              <Input
                aria-label="Adaglépés"
                inputMode="decimal"
                value={draft.doseStep}
                onChange={(event) =>
                  setDraft({ ...draft, doseStep: event.target.value })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">
                A gyártó napi legnagyobb adagja 100 literre
              </span>
              <Input
                aria-label="Napi legnagyobb adag"
                inputMode="decimal"
                value={draft.maxDailyDosePer100L}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxDailyDosePer100L: event.target.value,
                  })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-dusk-500">
                Hatásidő órában (üresen 24)
              </span>
              <Input
                aria-label="Hatásidő"
                inputMode="numeric"
                value={draft.effectHours}
                onChange={(event) =>
                  setDraft({ ...draft, effectHours: event.target.value })
                }
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-dusk-500">
              Forrás (gyártói oldal vagy címke)
            </span>
            <Textarea
              aria-label="Forrás"
              value={draft.source}
              onChange={(event) =>
                setDraft({ ...draft, source: event.target.value })
              }
            />
          </label>
          <div className="flex gap-2 pt-1">
            <Button disabled={busy} onClick={save}>
              Mentés
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Mégsem
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs">
        <Link href="/products/adag-lista" className="text-brand-600 underline">
          Az összes adag-hatás sor, ellenőrzésre várók
        </Link>
      </p>

      <ConfirmDialog
        open={archiving !== null}
        title="Archiválod ezt az adag-hatás sort?"
        consequence="A sor kikerül az élő listából, és nem használható többé adag-ajánláshoz. A helyére új sor rögzíthető ugyanerre a paraméterre."
        recovery="A sor és minden változata megmarad az archívumban, de visszaállítani nem lehet: ha mégis kell, rögzítsd újra, és egy második kolléga ellenőrizze."
        confirmLabel="Archiválás"
        busy={busy}
        onConfirm={() => {
          const id = archiving;
          setArchiving(null);
          if (id) void act(() => doseEffectApi.archive(token, id));
        }}
        onCancel={() => setArchiving(null)}
      />
    </PilotSection>
  );
}
