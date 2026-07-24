export interface CountryOption {
  code: string;
  label: string;
}

/// Magyarország alapértelmezett/első, utána ábécésorrendben a magyar
/// megnevezés szerint. Nem a teljes ISO 3166-1 lista, hanem a partnereink
/// szempontjából reális országkör.
export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "HU", label: "Magyarország" },
  { code: "AE", label: "Egyesült Arab Emírségek" },
  { code: "GB", label: "Egyesült Királyság" },
  { code: "US", label: "Amerikai Egyesült Államok" },
  { code: "AL", label: "Albánia" },
  { code: "AT", label: "Ausztria" },
  { code: "AU", label: "Ausztrália" },
  { code: "BE", label: "Belgium" },
  { code: "BA", label: "Bosznia-Hercegovina" },
  { code: "BG", label: "Bulgária" },
  { code: "BR", label: "Brazília" },
  { code: "CY", label: "Ciprus" },
  { code: "CZ", label: "Csehország" },
  { code: "DK", label: "Dánia" },
  { code: "MK", label: "Észak-Macedónia" },
  { code: "EE", label: "Észtország" },
  { code: "FI", label: "Finnország" },
  { code: "FR", label: "Franciaország" },
  { code: "GR", label: "Görögország" },
  { code: "NL", label: "Hollandia" },
  { code: "HR", label: "Horvátország" },
  { code: "IN", label: "India" },
  { code: "IE", label: "Írország" },
  { code: "IS", label: "Izland" },
  { code: "JP", label: "Japán" },
  { code: "CA", label: "Kanada" },
  { code: "CN", label: "Kína" },
  { code: "LV", label: "Lettország" },
  { code: "LI", label: "Liechtenstein" },
  { code: "LT", label: "Litvánia" },
  { code: "LU", label: "Luxemburg" },
  { code: "MT", label: "Málta" },
  { code: "MD", label: "Moldova" },
  { code: "ME", label: "Montenegró" },
  { code: "DE", label: "Németország" },
  { code: "NO", label: "Norvégia" },
  { code: "IT", label: "Olaszország" },
  { code: "PL", label: "Lengyelország" },
  { code: "PT", label: "Portugália" },
  { code: "RO", label: "Románia" },
  { code: "RS", label: "Szerbia" },
  { code: "SK", label: "Szlovákia" },
  { code: "SI", label: "Szlovénia" },
  { code: "ES", label: "Spanyolország" },
  { code: "SE", label: "Svédország" },
  { code: "CH", label: "Svájc" },
  { code: "TR", label: "Törökország" },
  { code: "UA", label: "Ukrajna" },
  { code: "KR", label: "Dél-Korea" },
];

/// A közösségi (EU-s) adószámok elején álló kétbetűs kód nem mindig egyezik
/// az ISO 3166-1 országkóddal - Görögország a "GR" ISO kóddal szemben "EL"
/// előtaggal ad ki adószámot. Amíg csak ez az egy eltérés ismert, egy kis
/// map elég; ha új eltérés kerül elő, itt bővítendő.
const VAT_PREFIX_TO_ISO_COUNTRY: Record<string, string> = { EL: "GR" };

/**
 * Országkód meghatározása az adószámból: ha a szám kétbetűs országkóddal
 * kezdődik (pl. "DE123456789"), az EU-s közösségi adószám formátumát
 * feltételezve abból olvassuk ki az országot; ha nincs betűjel (a magyar
 * "12345678-1-42" formátum), belföldi beszállítót feltételezünk, "HU"-t ad
 * vissza. Üres bemenetnél, vagy ha a felismert kód nincs a listánkban,
 * `undefined`-ot ad vissza - ilyenkor a hívó nem módosítja az Ország mezőt.
 */
export function inferCountryFromTaxNumber(
  taxNumber: string,
): string | undefined {
  const normalized = taxNumber.trim().replace(/\s+/g, "").toUpperCase();
  if (!normalized) return undefined;
  const match = /^([A-Z]{2})\d/.exec(normalized);
  if (!match) return "HU";
  const prefix = match[1] as string;
  const iso = VAT_PREFIX_TO_ISO_COUNTRY[prefix] ?? prefix;
  return COUNTRY_OPTIONS.some((option) => option.code === iso)
    ? iso
    : undefined;
}
