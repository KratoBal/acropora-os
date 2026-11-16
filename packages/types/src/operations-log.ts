/**
 * ÜZEMELTETÉSI NAPLÓ: A FELADAT-SABLON (task os-uzemeltetesi-naplo, S1; Balázs 2026-11-13 07:52 UTC "igen").
 *
 * A rendszeres üzemeltetési feladatok (napi, heti, alkalmi: például egy homokszűrő visszamosása) sablonja: a neve, a
 * gyakorisága, az eszköz vagy eszköz-kategória, amire szól, és a rögzítéskor kitöltendő mezői, amelyeket a felületen, kód
 * nélkül épít fel az admin. A bejegyzés (a rögzítés maga) a következő szelet (S2).
 *
 * NEM MUNKALAP (`ServiceJob`): az számlázott ügyfélmunka, ez belső rutin.
 *
 * A SZABÁLYOK EGY HELYEN ÁLLNAK, A SZERVEREN ÉS A FELÜLETEN IS: két másolatból az egyik előbb-utóbb mást csinálna, és a
 * különbség egy olyan hibaüzenet lenne, amelyet a felhasználó nem ért.
 */
export const OPERATIONS_TASK_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "OCCASIONAL",
] as const;
export type OperationsTaskFrequency =
  (typeof OPERATIONS_TASK_FREQUENCIES)[number];

export const OPERATIONS_FREQUENCY_LABELS: Readonly<
  Record<OperationsTaskFrequency, string>
> = {
  DAILY: "Napi",
  WEEKLY: "Heti",
  OCCASIONAL: "Alkalmi",
};

export const OPERATIONS_FIELD_TYPES = [
  "NUMBER",
  "BOOLEAN",
  "TEXT",
  "PHOTO",
] as const;
export type OperationsTaskFieldType = (typeof OPERATIONS_FIELD_TYPES)[number];

export const OPERATIONS_FIELD_TYPE_LABELS: Readonly<
  Record<OperationsTaskFieldType, string>
> = {
  NUMBER: "Szám",
  BOOLEAN: "Igen / nem",
  TEXT: "Szöveg",
  PHOTO: "Fénykép",
};

/**
 * A SZÁM MEZŐ SZEREPE A HAVI KIMUTATÁSBAN (S4): a vízóra állás a művelet ELŐTT, illetve UTÁN; a kimutatás a kettő különbségét
 * (utána mínusz előtte) mutatja. Más mezőnek nincs szerepe.
 */
export const OPERATIONS_METER_ROLES = ["BEFORE", "AFTER"] as const;
export type OperationsMeterRole = (typeof OPERATIONS_METER_ROLES)[number];

export const OPERATIONS_METER_ROLE_LABELS: Readonly<
  Record<OperationsMeterRole, string>
> = {
  BEFORE: "Vízóra állás előtte",
  AFTER: "Vízóra állás utána",
};

export const OPERATIONS_TEMPLATE_LIMITS = {
  nameMax: 120,
  descriptionMax: 1000,
  labelMax: 120,
  unitMax: 16,
  keyMax: 40,
  fieldsMax: 30,
} as const;

export interface OperationsTaskFieldDto {
  id: string;
  /** A mező stabil azonosítója a sablonon belül: a bejegyzés (S2) az értéket ezzel tárolja. */
  key: string;
  label: string;
  type: OperationsTaskFieldType;
  /** Mértékegység, csak szám mezőnél. */
  unit: string | null;
  required: boolean;
  /** Vízóra szerep a havi kimutatáshoz, csak szám mezőnél. */
  meterRole: OperationsMeterRole | null;
  sortOrder: number;
  /** A kivezetett mező kivezetésének ideje (a `fields` csak az aktívakat adja; a `retiredFields` a kivezetetteket). */
  removedAt: string | null;
}

/** A sablon célja: egy eszköz VAGY egy eszköz-kategória (pontosan az egyik). */
export type OperationsTaskTarget =
  | { kind: "ASSET"; assetId: string; assetNumber: string; name: string }
  | { kind: "CATEGORY"; categoryId: string; name: string };

export interface OperationsTaskTemplateDto {
  id: string;
  name: string;
  description: string | null;
  frequency: OperationsTaskFrequency;
  target: OperationsTaskTarget;
  /** A kivezetett sablon nem törlődik: a kínálatból esik ki, a régi bejegyzések mellett olvasható marad. */
  isActive: boolean;
  /** Az AKTÍV mezők, a megadott sorrendben. */
  fields: OperationsTaskFieldDto[];
  /**
   * A sablonból kimaradt (kivezetett) mezők: a régi bejegyzések (S2) értékéhez és a havi kimutatáshoz (S4) a definíciójuk
   * olvasható marad, a kulcsuk soha nem kerül másik mezőhöz (barracuda, #2497).
   */
  retiredFields: OperationsTaskFieldDto[];
  updatedAt: string;
}

export interface OperationsTaskTemplateListResponse {
  items: OperationsTaskTemplateDto[];
}

export interface OperationsTaskFieldInput {
  /** A meglévő mező megtartja a kulcsát; az új mezőé a címkéből készül. */
  key?: string | null;
  label: string;
  type: OperationsTaskFieldType;
  unit?: string | null;
  required?: boolean;
  meterRole?: OperationsMeterRole | null;
}

export interface OperationsTaskTemplateInput {
  /**
   * EGYIDEJŰSÉG-ŐR a módosításhoz (barracuda, #2497): a betöltött sablon `updatedAt`-je; ha közben más módosította, a szerver
   * 409-et ad, és a szerkesztő nem írja csendben felül a másik szerkesztő mezőit.
   */
  expectedUpdatedAt?: string | null;
  name: string;
  description?: string | null;
  frequency: OperationsTaskFrequency;
  assetId?: string | null;
  assetCategoryId?: string | null;
  /** A mezők a megadott sorrendben állnak; a lista a TELJES mezőkészletet adja (ami nincs benne, kikerül). */
  fields: OperationsTaskFieldInput[];
}

export function normalizeOperationsText(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A MEZŐ KULCSA A CÍMKÉBŐL: kisbetű, ékezet nélkül, csak `a-z0-9_`, legfeljebb 40 karakter. Üres címkéből (csak jelek)
 * `mezo` lesz, hogy a kulcs sosem üres.
 */
export function operationsFieldKeyOf(label: string): string {
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, OPERATIONS_TEMPLATE_LIMITS.keyMax)
    .replace(/_+$/g, "");
  return key === "" ? "mezo" : key;
}

/**
 * A KULCSOK KIOSZTÁSA A MEZŐLISTÁHOZ. A megadott kulcs CSAK akkor marad meg, ha a sablon AKTÍV mezőjének kulcsa (`active`), és még
 * nem foglalta le másik mező: a kliens által küldött tetszőleges szöveg nem lesz kulcs (barracuda, #2497). Az újé a címkéből
 * készül, és ütközésnél `_2`, `_3` ... utótagot kap. A `used` a sablon MINDEN VALAHA HASZNÁLT kulcsa (a kivezetetteké is): egy új
 * mező soha nem kaphatja egy elhagyott mező kulcsát, mert a régi bejegyzések értéke az övé lenne. A meglévő kulcs ELŐBB foglalt,
 * mint az újak, hogy egy új mező ne vihesse el egy később álló meglévő mező kulcsát. Létrehozáskor nincs egyik sem.
 */
export function assignOperationsFieldKeys(
  fields: readonly { key?: string | null; label: string }[],
  existing: {
    used?: ReadonlySet<string>;
    active?: ReadonlySet<string>;
  } = {},
): string[] {
  const used = new Set<string>(existing.used ?? []);
  const taken = new Set<string>();
  const result: (string | null)[] = fields.map(() => null);
  fields.forEach((field, index) => {
    const given = field.key?.trim();
    if (given && existing.active?.has(given) && !taken.has(given)) {
      taken.add(given);
      result[index] = given;
    }
  });
  taken.forEach((key) => used.add(key));
  fields.forEach((field, index) => {
    if (result[index] !== null) return;
    const base = operationsFieldKeyOf(field.label);
    let key = base;
    for (let n = 2; used.has(key); n += 1) {
      const suffix = `_${n}`;
      key = `${base.slice(0, OPERATIONS_TEMPLATE_LIMITS.keyMax - suffix.length)}${suffix}`;
    }
    used.add(key);
    result[index] = key;
  });
  return result as string[];
}

/**
 * A MEZŐLISTA SZABÁLYAI, magyar hibaüzenetekkel (üres lista: rendben). A szerver és a szerkesztő is ezt futtatja.
 *   - legfeljebb 30 mező, mindegyiknek címke (legfeljebb 120 karakter);
 *   - mértékegység (legfeljebb 16 karakter) és vízóra szerep csak szám mezőnél;
 *   - vízóra szerepből legfeljebb egy „előtte" és egy „utána" mező.
 */
export function operationsFieldErrors(
  fields: readonly OperationsTaskFieldInput[],
): string[] {
  const limits = OPERATIONS_TEMPLATE_LIMITS;
  const errors: string[] = [];
  if (fields.length > limits.fieldsMax)
    errors.push(`Egy sablonnak legfeljebb ${limits.fieldsMax} mezője lehet.`);
  fields.forEach((field, index) => {
    const row = `${index + 1}. mező`;
    const label = field.label.trim();
    if (label === "") errors.push(`${row}: a címkét meg kell adni.`);
    if (label.length > limits.labelMax)
      errors.push(
        `${row}: a címke legfeljebb ${limits.labelMax} karakter lehet.`,
      );
    const unit = normalizeOperationsText(field.unit);
    if (unit !== null && field.type !== "NUMBER")
      errors.push(`${row}: mértékegység csak szám mezőnél adható meg.`);
    if (unit !== null && unit.length > limits.unitMax)
      errors.push(
        `${row}: a mértékegység legfeljebb ${limits.unitMax} karakter lehet.`,
      );
    if (field.meterRole && field.type !== "NUMBER")
      errors.push(`${row}: vízóra szerep csak szám mezőnél adható meg.`);
  });
  for (const role of OPERATIONS_METER_ROLES) {
    const count = fields.filter((field) => field.meterRole === role).length;
    if (count > 1)
      errors.push(
        `Legfeljebb egy mező lehet „${OPERATIONS_METER_ROLE_LABELS[role]}”.`,
      );
  }
  return errors;
}
