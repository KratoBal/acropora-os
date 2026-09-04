import { normalizeBrandText } from "./brand-normalizer.js";

export const BRAND_DICTIONARY_VERSION = "unas-brands-2026-07-19-v1";

export const SOURCE_BRAND_NAMES = [
  "ATB",
  "ATI",
  "Aqua Illumination",
  "Aqua Light",
  "AquaMedic",
  "Aquaforest",
  "Aquarioom",
  "Aquatic Nature",
  "Aquili",
  "Arka",
  "AutoAqua",
  "Blue Life",
  "Bubble Magus",
  "Calanus",
  "Coral Essentials",
  "Coral RX",
  "D-D",
  "Dr. Bassleer",
  "Dupla Marin",
  "Dutch Reef",
  "Easy-Life",
  "Ecotech",
  "Eheim",
  "Fauna Marin",
  "First Bite",
  "Flipper",
  "Grotech",
  "Hanna",
  "Jebao/Jecod",
  "Korallen-Zucht",
  "Magfloat",
  "Maxspect",
  "Microbe-Lift",
  "Modern Reef",
  "New Life Spectrum",
  "Nyos",
  "OASE",
  "Oase",
  "Ocean Nutrition",
  "Polyp Lab",
  "RedSea",
  "Reef Factory",
  "Salifert",
  "Triton",
  "Tropic Marin",
  "Tunze",
  "VCA",
  "Vitalis",
  "Xepta",
] as const;

export interface BrandDictionaryEntry {
  key: string;
  name: string;
  aliases: string[];
  manufacturerPrefixes: string[];
  skuPrefixes: string[];
}

/**
 * AZ ELGEPELT ALAKOK, AMIK A KATALOGUSBAN ALLNAK.
 *
 * Merve a 09-03-as UNAS exporton, mind az 1893 terméknev ellen, betu-tavolsaggal:
 * ot alak ter el EGY betuben valamelyik szotari nevtol, es mind az ot a nev
 * ELEJEN all. Egyuttesen het termeket erintenek, es kozuluk hat ma marka nelkul
 * marad (a hetediknel a `brand` mezo helyesen all, tehat a nevbeli elteres ott
 * nem okoz kart -- de az alak akkor is ott van).
 *
 * A KUSZOB NEM IZLES, HANEM KALIBRALT: legfeljebb EGY betu elteres, es legalabb
 * OT karakteres normalizalt szotari alak. A probaja a szotar SAJAT nevei
 * egymas ellen -- ha ket KULONBOZO marka a meron belul egymas elgepelese, akkor
 * a mero nem donteni tud, hanem osszemosni:
 *
 *   tav<=1, barmilyen hossz   2 hamis par   (AI/ATI, ATB/ATI)
 *   tav<=1, hossz>=5          0 hamis par   <- EZ a sav
 *   tav<=2, barmilyen hossz   5 hamis par
 *   tav<=2, hossz>=5          1 hamis par   (Ecotech/Grotech)
 *
 * ES A KONTROLL NEM MARADT ELMELETI: ket betu tavolsaggal a katalogus 298
 * talalatot ad, es a ket legnagyobb csoport pontosan a megjosolt par -- a
 * Grotech nevek a szotari Ecotech ellen 62 termeken, az Ecotech nevek a Grotech
 * ellen 26-on. Ezert all kulon allitas arra, hogy az "ecotech" nev NEM oldodik
 * fel Grotech-re: az koti be ezt a kontrollt a tesztsorba.
 *
 * AMI SZANDEKOSAN KIMARADT: a ot betunel rovidebb es a ketertelmu alakok (ATB,
 * ATI, AI, Arka, D-D, KZ, Nyos, OASE, VCA). Nem azert, mert ott nincs elgepeles,
 * hanem mert a betu-tavolsag ott nem hasznalhato mero. Azok MERETLENEK, nem
 * tisztak, es masik jel kell hozzajuk.
 */
const aliases: Record<string, string[]> = {
  "aqua illumination": ["AI"],
  aquamedic: ["Aqua Medic", "Aqua Mdic"],
  "coral essentials": ["Coral Essential"],
  ecotech: ["EcoTech Marine"],
  "fauna marin": ["Fauna Marine"],
  grotech: ["Groteh"],
  "jebao jecod": ["Jebao", "Jecod"],
  "korallen zucht": ["KZ", "Korallen-zuht"],
  redsea: ["Red Sea"],
  "polyp lab": ["PolypLab"],
};

const prefixes: Record<string, string[]> = {
  eheim: ["EHEIM"],
  jebao: ["JEBAO", "JECOD"],
  maxspect: ["MAXSPECT"],
  tunze: ["TUNZE"],
  aquaforest: ["AQUAFOREST"],
  salifert: ["SALIFERT"],
};

const canonical = new Map<string, string>();
for (const name of SOURCE_BRAND_NAMES) {
  const normalized = normalizeBrandText(name);
  if (!canonical.has(normalized)) canonical.set(normalized, name);
}

export const BRAND_DICTIONARY: BrandDictionaryEntry[] = [...canonical].map(
  ([normalized, name]) => {
    const key = normalized.replace(/ /g, "-");
    const prefixKey = normalized === "jebao jecod" ? "jebao" : normalized;
    return {
      key,
      name: normalized === "oase" ? "OASE" : name,
      aliases: [name, ...(aliases[normalized] ?? [])],
      manufacturerPrefixes: prefixes[prefixKey] ?? [],
      skuPrefixes: prefixes[prefixKey] ?? [],
    };
  },
);

export const AMBIGUOUS_BRAND_ALIASES = new Set(["ai", "dd", "kz"]);

export const GENERIC_BRAND_TERMS = new Set([
  "akvarium",
  "termekek",
  "vilagitas",
  "szures",
  "pumpa",
  "tap",
  "eleseg",
  "kiegeszito",
  "tengeri",
  "edesvizi",
  "led",
]);
