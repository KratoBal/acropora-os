"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "@acropora/ui";
import {
  HUSBANDRY_DIFFICULTY_SCALE,
  type ProductDetail,
  type ProductHusbandry,
  type ProductHusbandryFacts,
  type ProductHusbandryInput,
} from "@acropora/types";
import { type FormEvent, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { productApi } from "@/lib/api/products";

/**
 * A TARTÁSI BLOKK SZERKESZTŐJE (V2.2 S2, kártya d2fc06e7): az élő állat tartási adatai a termék adatlapján. A tények az
 * OS-ben tárolódnak (`ProductDatasheet`), a mentés a `PATCH /products/:id/husbandry` végpontra megy. A blokk csak élő
 * állatnál jelenik meg (a kategória-fából a szerver mondja: `livestockKind`).
 *
 * AMIT A KÁRTYA NEM CSINÁL: nem tölt be adatot, és nem talál ki alapértéket. Az üres mező jelentése "ellenőrzés alatt" (a spec
 * szerint semmi nem találgatható), a hiányzó kötelező mezőket név szerint felsorolja. Az első lépcsőben (acrobot, 2026-11-04)
 * ez csak JELZÉS: semmi nem tűnik el a kirakatról, a hiánylista a szerkesztőnek szól.
 *
 * AZ ELLENŐRZÉS A SZERVERÉ: a "Mentés és ellenőrzöm" gomb `ellenorizve: true`-t küld, és a szerver bélyegzi, ki és mikor (a
 * kártya nem küld nevet vagy időt). Egy sima mentés visszavonja a korábbi ellenőrzést: az új tartalmat senki nem ellenőrizte, és
 * a kártya ezt ki is írja, nem hallgatja el.
 */

type Option = { value: string; label: string };

type FieldDef =
  | {
      key: keyof ProductHusbandryFacts;
      label: string;
      kind: "text";
      help?: string;
    }
  | {
      key: keyof ProductHusbandryFacts;
      label: string;
      kind: "number";
      help?: string;
    }
  | {
      key: keyof ProductHusbandryFacts;
      label: string;
      kind: "select";
      options: Option[];
    }
  | { key: keyof ProductHusbandryFacts; label: string; kind: "bool" }
  | {
      key: keyof ProductHusbandryFacts;
      label: string;
      kind: "multi";
      options: Option[];
    };

const NEED: Option[] = [
  { value: "GYENGE", label: "Alacsony" },
  { value: "KOZEPES", label: "Közepes" },
  { value: "EROS", label: "Magas / erős" },
  { value: "NEM_ERTELMEZHETO", label: "Nem értelmezhető" },
];

/** A mezők, a spec "Kötelező" és az eddigi adatlap sorrendjében. A magyar név a Nevek kártyán szerkeszthető. */
const FIELDS: FieldDef[] = [
  { key: "genus", label: "Nemzetség", kind: "text" },
  { key: "species", label: "Faj", kind: "text" },
  {
    key: "careDifficulty",
    label: "Tartási nehézség",
    kind: "select",
    options: (["KONNYU", "KOZEPES", "HALADO", "SZAKERTO"] as const).map(
      (value) => ({
        value,
        label: `${HUSBANDRY_DIFFICULTY_SCALE[value].level}. ${HUSBANDRY_DIFFICULTY_SCALE[value].label}`,
      }),
    ),
  },
  { key: "minLiter", label: "Minimális medence (liter)", kind: "number" },
  {
    key: "medenceErettsegHonap",
    label: "Legalább ennyi hónapos, stabil medence",
    kind: "number",
  },
  {
    key: "elhelyezesZona",
    label: "Elhelyezés a medencében",
    kind: "select",
    options: [
      { value: "ALSO", label: "Alsó zóna" },
      { value: "KOZEPSO", label: "Középső zóna" },
      { value: "FELSO", label: "Felső zóna" },
    ],
  },
  {
    key: "reefSafe",
    label: "Korallos akváriumban tartható",
    kind: "select",
    options: [
      { value: "IGEN", label: "Igen" },
      { value: "FELTETELES", label: "Korlátozottan" },
      { value: "NEM", label: "Nem" },
      { value: "ALLITAS_NELKULI", label: "Nincs állítás" },
      { value: "NEM_FAJ_SZINTU", label: "Nem faj szintű" },
    ],
  },
  { key: "reefSafeIndok", label: "Miért (egy mondat)", kind: "text" },
  {
    key: "socialKeeping",
    label: "Csoportban tartható",
    kind: "select",
    options: [
      { value: "EGYEDUL", label: "Egyedül" },
      { value: "PARBAN", label: "Párban" },
      { value: "CSOPORTBAN", label: "Csoportban" },
      { value: "TOBB_PELDANY_TARTHATO", label: "Több példány tartható" },
    ],
  },
  {
    key: "aggression",
    label: "Viselkedés",
    kind: "multi",
    options: [
      { value: "BEKES", label: "Békés" },
      { value: "TERULETVEDO", label: "Területvédő" },
      { value: "RAGADOZO", label: "Ragadozó" },
      { value: "CSALANOZ", label: "Csalánoz" },
      { value: "FAJTARSSAL_AGRESSZIV", label: "Fajtárssal agresszív" },
      { value: "FELTETELES", label: "Feltételes" },
    ],
  },
  { key: "korallevo", label: "Korallevő", kind: "bool" },
  { key: "gerinctelenevo", label: "Gerinctelen-evő", kind: "bool" },
  {
    key: "feedingType",
    label: "Táplálék-típus",
    kind: "multi",
    options: [
      { value: "SZURO_PLANKTON", label: "Szűrő (plankton)" },
      { value: "ALGAEVO", label: "Algaevő" },
      { value: "HUSEVO", label: "Húsevő" },
      { value: "MINDENEVO", label: "Mindenevő" },
      { value: "TORMELEKEVO", label: "Törmelékevő" },
      { value: "FOTOSZINTETIZALO", label: "Fotoszintetizáló" },
      { value: "TISZTOGATO", label: "Tisztogató" },
    ],
  },
  { key: "etetesGyakorisag", label: "Etetési gyakoriság", kind: "text" },
  { key: "eloEleseg", label: "Kell élő eleség", kind: "bool" },
  { key: "fenyIgeny", label: "Fényigény", kind: "select", options: NEED },
  { key: "aramlasIgeny", label: "Áramlásigény", kind: "select", options: NEED },
  { key: "meretMax", label: "Kifejlett méret (cm)", kind: "number" },
  {
    key: "meretDimenzio",
    label: "A méret mit mér",
    kind: "select",
    options: [
      { value: "TESTHOSSZ", label: "Testhossz" },
      { value: "KARFESZTAVOLSAG", label: "Karfesztávolság" },
      { value: "HEJMERET", label: "Héjméret" },
      { value: "TELJES_KITERJEDES", label: "Teljes kiterjedés" },
    ],
  },
  {
    key: "szarmazas",
    label: "Származás (a bolti szállítmányé)",
    kind: "select",
    options: [
      { value: "TENYESZTETT", label: "Tenyésztett" },
      { value: "VADFOGAS", label: "Vadfogás" },
    ],
  },
  { key: "kinekNem", label: "Kinek NEM ajánljuk (egy mondat)", kind: "text" },
  /*
    THE OPTIONAL FACTS (V2.2 S1b): never required, never in the missing list; empty means "being checked". They stand under the
    block's one verification: editing any of them withdraws it.
  */
  { key: "tempMinC", label: "Hőmérséklet, alsó határ (°C)", kind: "number" },
  { key: "tempMaxC", label: "Hőmérséklet, felső határ (°C)", kind: "number" },
  {
    key: "salinityMinSg",
    label: "Sótartalom, alsó határ (SG)",
    kind: "number",
  },
  {
    key: "salinityMaxSg",
    label: "Sótartalom, felső határ (SG)",
    kind: "number",
  },
  { key: "khMinDkh", label: "KH, alsó határ (dKH)", kind: "number" },
  { key: "khMaxDkh", label: "KH, felső határ (dKH)", kind: "number" },
  { key: "lifespanYears", label: "Várható élettartam (év)", kind: "number" },
  { key: "stingOrVenom", label: "Csípés vagy méreg", kind: "bool" },
  {
    key: "handlingWarning",
    label: "Kezelési figyelmeztetés (csípésnél vagy mérgnél kötelező)",
    kind: "text",
  },
  { key: "quarantineWeeks", label: "Karantén-ajánlás (hét)", kind: "number" },
  { key: "acclimatization", label: "Akklimatizáció módja", kind: "text" },
  { key: "breedsInTank", label: "Szaporítható a medencében", kind: "bool" },
  { key: "forrasTipus", label: "A forrás típusa", kind: "text" },
  { key: "forrasHivatkozas", label: "A forrás hivatkozása", kind: "text" },
];

/** A hiánylista nevei: a mezők címkéi, plusz a két szerver-oldali jelzés. */
const MISSING_LABELS: Record<string, string> = {
  ...Object.fromEntries(FIELDS.map((field) => [field.key, field.label])),
  magyarNev: "Magyar név (a Nevek kártyán)",
  livestockKind: "Az állat fajtája (a kategória-fából nem derül ki)",
  verification: "Ellenőrzés",
};

type FormValue = string | string[];
type FormState = Record<string, FormValue>;

const asString = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

/** A szerver értékéből az űrlap-érték. */
function formOf(facts: ProductHusbandryFacts): FormState {
  const state: FormState = {};
  for (const field of FIELDS) {
    const value = facts[field.key];
    if (field.kind === "multi") state[field.key] = [...(value as string[])];
    else if (field.kind === "bool")
      state[field.key] = value === null ? "" : value ? "true" : "false";
    else state[field.key] = asString(value);
  }
  return state;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/**
 * A VÁLTOZÁS: csak az eltérő mezők mennek (az üres mező törlést jelent, `null`). Hibás szám esetén a hívó megkapja a
 * mező nevét, és nem megy el semmi.
 */
export function husbandryChanges(
  facts: ProductHusbandryFacts,
  form: FormState,
): { input: ProductHusbandryInput; badNumber: string | null } {
  const before = formOf(facts);
  const input: Record<string, unknown> = {};
  let badNumber: string | null = null;
  for (const field of FIELDS) {
    const next = form[field.key]!;
    const prev = before[field.key]!;
    if (field.kind === "multi") {
      if (!sameList(next as string[], prev as string[]))
        input[field.key] = (next as string[]).length ? next : null;
      continue;
    }
    const text = (next as string).trim();
    if (text === (prev as string).trim()) continue;
    if (field.kind === "bool")
      input[field.key] = text === "" ? null : text === "true";
    else if (field.kind === "number") {
      if (text === "") input[field.key] = null;
      else if (!Number.isFinite(Number(text))) badNumber = field.label;
      else input[field.key] = Number(text);
    } else input[field.key] = text === "" ? null : text;
  }
  return { input: input as ProductHusbandryInput, badNumber };
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "A mentés nem sikerült.";

export function ProductHusbandryCard({
  token,
  product,
  canManage,
}: {
  token: string;
  product: ProductDetail;
  canManage: boolean;
}) {
  const [husbandry, setHusbandry] = useState<ProductHusbandry | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // the facts changed since this screen loaded them (a 409): a verification of unseen content was refused
  const [stale, setStale] = useState(false);
  const isLiveAnimal = product.livestockKind !== null;

  useEffect(() => {
    if (!isLiveAnimal) return;
    let cancelled = false;
    productApi
      .husbandry(token, product.id)
      .then((loaded) => {
        if (cancelled) return;
        setHusbandry(loaded);
        setForm(formOf(loaded.facts));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [token, product.id, isLiveAnimal]);

  if (!isLiveAnimal) return null;

  const save = async (verify: boolean) => {
    if (busy || !canManage || !husbandry) return;
    setError(null);
    setNotice(null);
    const { input, badNumber } = husbandryChanges(husbandry.facts, form);
    if (badNumber) {
      setError(`A(z) "${badNumber}" mezőbe számot írj.`);
      return;
    }
    if (Object.keys(input).length === 0 && !verify) {
      setNotice("Nincs változás, nincs mit menteni.");
      return;
    }
    setBusy(true);
    try {
      /*
        THE VERIFICATION NAMES THE VERSION THIS SCREEN LOADED (barracuda on #2375): the stamp says someone looked at THESE
        facts, so the server refuses it (409) when they changed since (another tab, a colleague, the names path). A plain
        save needs no version: it withdraws a verification, it never states one.
      */
      const saved = await productApi.updateHusbandry(token, product.id, {
        ...input,
        ...(verify
          ? { ellenorizve: true, seenVersion: husbandry.version }
          : {}),
      });
      setStale(false);
      setHusbandry(saved);
      setForm(formOf(saved.facts));
      setNotice(
        verify
          ? "Elmentve és ellenőrizve (a szerverről visszaolvasva)."
          : "Elmentve. A korábbi ellenőrzés ezzel visszavonódott, ha volt.",
      );
    } catch (cause) {
      setError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 409) setStale(true);
    } finally {
      setBusy(false);
    }
  };

  /** After a 409: read the facts again (the edits typed on this screen are dropped), and look them over before verifying. */
  const reload = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await productApi.husbandry(token, product.id);
      setHusbandry(loaded);
      setForm(formOf(loaded.facts));
      setStale(false);
      setNotice("Újratöltve a szerverről. Nézd át, és utána ellenőrizd.");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };

  const setValue = (key: string, value: FormValue) =>
    setForm((current) => ({ ...current, [key]: value }));
  const disabled = busy || !canManage || !husbandry;

  return (
    <PilotCard>
      <PilotCardHeader title="Tartási adatok" />
      <div className="p-5">
        <p className="text-xs text-dusk-500">
          Az élő állat tartási adatai. Az üres mező azt jelenti: ellenőrzés
          alatt; semmit nem töltünk ki találgatásból. A hiányzó kötelező mezők
          alább állnak, ez ma csak jelzés, a termék nem tűnik el miatta.
        </p>
        {error ? (
          <Alert
            className="mt-3"
            variant="danger"
            title="A mentés nem sikerült"
            description={error}
          />
        ) : null}
        {notice ? (
          <Alert
            className="mt-3"
            variant="info"
            title="Mentve"
            description={notice}
          />
        ) : null}
        {/*
          A CSÍPÉS VAGY MÉREG KIEMELVE (V2.2 follow-up, acrobot 46293): a jelző egyébként csak egy választó a többi közt, és aki ellenőrzi a
          blokkot, ezt nem szabad véletlenül átlapozza. A SZERVEREN TÁROLT állapotot mutatja (nem a még nem mentett piszkozatot), a kezelési
          figyelmeztetés szövegével; ha az nincs, azt mondja ki (az írási szabály ezt nem engedi, de egy régi vagy megkerült sor igen).
        */}
        {husbandry?.facts.stingOrVenom === true ? (
          <Alert
            className="mt-3"
            variant="danger"
            title="Csípés vagy méreg"
            description={
              husbandry.facts.handlingWarning?.trim()
                ? husbandry.facts.handlingWarning
                : "A kezelési figyelmeztetés hiányzik: add meg, mielőtt ellenőrzöd."
            }
          />
        ) : null}
        {husbandry ? (
          <div className="mt-3 space-y-2" data-testid="husbandry-status">
            <div>
              {husbandry.verification.verified ? (
                <PilotBadge variant="success">
                  Ellenőrizve:{" "}
                  {new Date(husbandry.verification.at ?? "").toLocaleDateString(
                    "hu-HU",
                  )}
                </PilotBadge>
              ) : (
                <PilotBadge variant="amber">Nincs ellenőrizve</PilotBadge>
              )}
            </div>
            {husbandry.missing.length > 0 ? (
              <p className="text-xs text-dusk-500">
                Hiányzik:{" "}
                {husbandry.missing
                  .map((key) => MISSING_LABELS[key] ?? key)
                  .join(", ")}
                .
              </p>
            ) : (
              <p className="text-xs text-dusk-500">
                Minden kötelező mező kitöltött.
              </p>
            )}
          </div>
        ) : null}
        {husbandry ? (
          <p className="mt-3 text-sm" data-testid="husbandry-name">
            Magyar név:{" "}
            <strong>{husbandry.facts.magyarNev ?? "nincs kitöltve"}</strong> (a
            Nevek kártyán szerkeszthető; ez is az ellenőrzött blokk része)
          </p>
        ) : null}
        {stale ? (
          <div className="mt-3">
            <PilotButton
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              Újratöltés
            </PilotButton>
          </div>
        ) : null}
        <form className="mt-4 space-y-4" onSubmit={submit}>
          {FIELDS.map((field) => {
            const id = `husbandry-${field.key}`;
            const value = form[field.key];
            if (value === undefined) return null;
            if (field.kind === "multi")
              return (
                <fieldset key={field.key} className="space-y-1">
                  <legend className="text-sm font-medium">{field.label}</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {field.options.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-1 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={(value as string[]).includes(option.value)}
                          disabled={disabled}
                          onChange={(event) =>
                            setValue(
                              field.key,
                              event.target.checked
                                ? [...(value as string[]), option.value]
                                : (value as string[]).filter(
                                    (item) => item !== option.value,
                                  ),
                            )
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            return (
              <PilotFormField key={field.key} label={field.label} htmlFor={id}>
                {field.kind === "select" || field.kind === "bool" ? (
                  <PilotSelect
                    id={id}
                    value={value as string}
                    onChange={(next) => setValue(field.key, next)}
                    disabled={disabled}
                  >
                    <option value="">Ellenőrzés alatt</option>
                    {field.kind === "bool" ? (
                      <>
                        <option value="true">Igen</option>
                        <option value="false">Nem</option>
                      </>
                    ) : (
                      field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </PilotSelect>
                ) : (
                  <PilotInput
                    id={id}
                    value={value as string}
                    onChange={(next) => setValue(field.key, next)}
                    disabled={disabled}
                  />
                )}
              </PilotFormField>
            );
          })}
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <PilotButton type="submit" disabled={disabled}>
                {busy ? "Mentés…" : "Mentés"}
              </PilotButton>
              <PilotButton
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={() => void save(true)}
              >
                Mentés és ellenőrzöm
              </PilotButton>
            </div>
          ) : null}
        </form>
      </div>
    </PilotCard>
  );
}
