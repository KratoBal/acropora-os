import { parseWaterParameterEffects } from "@acropora/jev/product-enrichment";

/**
 * A KATEGÓRIA-SZABÁLY (kártya 2b3983e1, D1): a UNAS-fa ága mondja a hatást, csak
 * ott, ahol a besorolás maga egyértelmű (a megkötők és a tengeri só). A mi
 * katalógusunk állítása, tehát `UNAS_CURRENT` forrásként megy az egyeztetőbe:
 * egyedül UNVERIFIED, egy egyező független oldallal VERIFIED, egy eltérővel
 * ütközés (a JEV egyeztetőjének mai szabálya, ehhez nem kellett nyúlni).
 *
 * A lista átnézve: `vizmeres-ajanlas-szotar-2026-10-09.md`, 2. pont.
 */
export const WATER_EFFECT_CATEGORY_RULES: readonly {
  parent: string;
  name: string;
  effects: string;
}[] = [
  {
    parent: "Vízkezelés",
    name: "Foszfátmegkötők",
    effects: "FOSZFAT:CSOKKENT",
  },
  {
    parent: "Problémamegoldás",
    name: "Foszfátmegkötők",
    effects: "FOSZFAT:CSOKKENT",
  },
  {
    parent: "Problémamegoldás",
    name: "Nitrátmegkötők",
    effects: "NITRAT:CSOKKENT",
  },
  {
    parent: "Vízkezelés",
    name: "Szilikát megkötők",
    effects: "SZILIKAT:CSOKKENT",
  },
  { parent: "Problémamegoldás", name: "Fémmegkötők", effects: "REZ:CSOKKENT" },
  { parent: "Termékek", name: "Tengeri só", effects: "SOTARTALOM:EMEL" },
];

/**
 * A termék UNAS-kategóriáiból a hatás: a szabályos ágak hatásainak uniója, a
 * kanonikus alakban, és a hivatkozás a talált ágakra. Az ág ALATTI kategória is
 * számít (egy márka-alág a Tengeri só alatt), ezért a teljes ős-lánc nevét kapja.
 */
export function waterEffectsFromCategories(
  categories: readonly { chain: readonly string[] }[],
): { raw: string; sourceRef: string } | null {
  const hatasok: string[] = [];
  const agak = new Set<string>();
  for (const { chain } of categories)
    for (const rule of WATER_EFFECT_CATEGORY_RULES) {
      const i = chain.indexOf(rule.name);
      if (i > 0 && chain[i - 1] === rule.parent) {
        hatasok.push(rule.effects);
        agak.add(`${rule.parent} > ${rule.name}`);
      }
    }
  if (hatasok.length === 0) return null;
  const parsed = parseWaterParameterEffects(hatasok.join(";"));
  // két ág ellentétes iránya: a szabály nem állít semmit
  if (!parsed.ok) return null;
  return {
    raw: parsed.canonical,
    sourceRef: `unas-category:${[...agak].sort().join(" | ")}`,
  };
}
