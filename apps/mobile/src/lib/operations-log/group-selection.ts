// RELATÍV ÚT, NEM `@/`: a teszt-fordító nem ismeri az aliast (`tsconfig.test.json`-ban nincs `paths`).
import { commonTemplates } from "./group-form";

/**
 * A CSOPORTOS RÖGZÍTÉSHEZ KIJELÖLHETŐ ESZKÖZÖK AZ ESZKÖZLISTÁN (Balázs, 2026-11-17 07:55 UTC: a csoportos képernyő „nincs közös üzemeltetési
 * sablonja” hibát adott, mert a lista engedte összevalogatni a különböző sablonú eszközöket, és csak a csoportos képernyő szólt utólag).
 *
 * A SZABÁLY: az első kijelölés után csak az az eszköz jelölhető, amellyel a már kijelöltek KÖZÖS sablonja nem üres (`commonTemplates`, ugyanaz
 * a szabály, amit a csoportos képernyő használ, tehát a lista és a képernyő nem tud ellentmondani egymásnak). Aki nem jelölhető, rövid
 * indokot kap; a kijelöltek mindig kivehetők. A csoportos gomb csak akkor aktív, ha a kijelöltek sablon-listája mind megvan, és van
 * közös sablon.
 *
 * A SABLON AZ ESZKÖZRE VAGY AZ ESZKÖZ KATEGÓRIÁJÁRA SZÓL (szerver: `activeTemplatesForAsset`), tehát a kategória neve nem elég a döntéshez: az
 * eszközönkénti sablon-lista kell. Ez a modul csak a döntést hozza; a listákat a képernyő tölti (eszközönként egy hívás, az első kijelölés
 * UTÁN, ugyanazzal a gyorsítótár-kulccsal, mint a csoportos képernyőn).
 */
export const BLOCKED_OTHER_TEMPLATE = "Más sablon: nem jelölhető";
export const BLOCKED_NOT_LOADED = "A sablon nem töltődött be: nem jelölhető";

/** Egy eszköz sablon-listájának állapota: `undefined` = még töltődik, `"failed"` = nem sikerült (és nincs mentett másolat), különben a lista. */
export type TemplateListState =
  readonly { id: string }[] | "failed" | undefined;

export type GroupRowState =
  | { kind: "free" }
  | { kind: "selected" }
  | { kind: "loading" }
  | { kind: "blocked"; reason: string };

/** Minden eszköz sorának állapota a kijelölés és a már ismert sablon-listák alapján. */
export function groupRowStates(input: {
  assetIds: readonly string[];
  selected: readonly string[];
  templates: Readonly<Record<string, TemplateListState>>;
}): Record<string, GroupRowState> {
  const out: Record<string, GroupRowState> = {};
  const lists = (ids: readonly string[]) =>
    ids.map((id) => input.templates[id]);
  const selectedLists = lists(input.selected);
  const selectedKnown = selectedLists.every((list) => Array.isArray(list));
  const selectedFailed = selectedLists.some((list) => list === "failed");
  for (const id of input.assetIds) {
    if (input.selected.includes(id)) {
      out[id] = { kind: "selected" };
      continue;
    }
    // semmi sincs kijelölve: nincs mivel összevetni, bárki jelölhető
    if (input.selected.length === 0) {
      out[id] = { kind: "free" };
      continue;
    }
    const own = input.templates[id];
    if (own === "failed" || selectedFailed) {
      out[id] = { kind: "blocked", reason: BLOCKED_NOT_LOADED };
      continue;
    }
    if (own === undefined || !selectedKnown) {
      out[id] = { kind: "loading" };
      continue;
    }
    const known = selectedLists as readonly (readonly { id: string }[])[];
    out[id] =
      commonTemplates([...known, own]).length > 0
        ? { kind: "free" }
        : { kind: "blocked", reason: BLOCKED_OTHER_TEMPLATE };
  }
  return out;
}

/** Nyomható-e a csoportos gomb: legalább két kijelölt, mindegyik sablon-listája megvan, és van közös sablon. */
export function groupSelectionReady(input: {
  selected: readonly string[];
  templates: Readonly<Record<string, TemplateListState>>;
}): boolean {
  if (input.selected.length < 2) return false;
  const lists = input.selected.map((id) => input.templates[id]);
  if (!lists.every((list) => Array.isArray(list))) return false;
  return (
    commonTemplates(lists as readonly (readonly { id: string }[])[]).length > 0
  );
}
