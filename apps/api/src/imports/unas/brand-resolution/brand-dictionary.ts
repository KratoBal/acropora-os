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

const aliases: Record<string, string[]> = {
  "aqua illumination": ["AI"],
  aquamedic: ["Aqua Medic"],
  ecotech: ["EcoTech Marine"],
  "jebao jecod": ["Jebao", "Jecod"],
  "korallen zucht": ["KZ"],
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
