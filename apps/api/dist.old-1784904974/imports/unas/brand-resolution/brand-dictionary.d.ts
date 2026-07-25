export declare const BRAND_DICTIONARY_VERSION = "unas-brands-2026-07-19-v1";
export declare const SOURCE_BRAND_NAMES: readonly ["ATB", "ATI", "Aqua Illumination", "Aqua Light", "AquaMedic", "Aquaforest", "Aquarioom", "Aquatic Nature", "Aquili", "Arka", "AutoAqua", "Blue Life", "Bubble Magus", "Calanus", "Coral Essentials", "Coral RX", "D-D", "Dr. Bassleer", "Dupla Marin", "Dutch Reef", "Easy-Life", "Ecotech", "Eheim", "Fauna Marin", "First Bite", "Flipper", "Grotech", "Hanna", "Jebao/Jecod", "Korallen-Zucht", "Magfloat", "Maxspect", "Microbe-Lift", "Modern Reef", "New Life Spectrum", "Nyos", "OASE", "Oase", "Ocean Nutrition", "Polyp Lab", "RedSea", "Reef Factory", "Salifert", "Triton", "Tropic Marin", "Tunze", "VCA", "Vitalis", "Xepta"];
export interface BrandDictionaryEntry {
    key: string;
    name: string;
    aliases: string[];
    manufacturerPrefixes: string[];
    skuPrefixes: string[];
}
export declare const BRAND_DICTIONARY: BrandDictionaryEntry[];
export declare const AMBIGUOUS_BRAND_ALIASES: Set<string>;
export declare const GENERIC_BRAND_TERMS: Set<string>;
