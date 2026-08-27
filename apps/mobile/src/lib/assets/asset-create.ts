import type { AssetKind, AssetOwnerType } from "./asset-fields";

/**
 * Az ÚJ ESZKÖZ űrlap logikája, a képernyőtől külön.
 *
 * Azért külön modul, mert az appban nincs komponens-teszt eszköz: ami a
 * képernyő törzsében marad, azt csak kézzel, telefonon lehet kipróbálni. Az
 * `asset-edit.ts` ugyanezért készült így.
 *
 * A mért hiba, ami miatt ez a modul megszületett (2026-08-25): a képernyő a
 * kézzel írt dátumhoz hozzáfűzte a `T00:00:00.000Z` végződést, és úgy küldte el.
 * A szerver `@IsISO8601`-et vár, tehát a magyar szokás szerinti `2026.08.25`
 * alak 400-as választ kapott, a hibaüzenet pedig a képernyő tetején jelent meg,
 * ahonnan a mentés gomb már régen kigörgött. A felhasználó ebből annyit látott,
 * hogy a gomb NEM CSINÁL SEMMIT.
 */

export interface AssetCreateForm {
  owner: { type: AssetOwnerType; id: string } | null;
  /**
   * A partner alegysége, ahol az eszköz áll. Üres, amíg nincs kiválasztva, és
   * SZERVIZ PARTNER tulajdonosnál értelmes csak: vevőnél a szerver el is
   * utasítaná, mert ott a cím a pontosítás.
   */
  unitId: string;
  name: string;
  kind: AssetKind;
  manufacturer: string;
  model: string;
  serialNumber: string;
  /** Amit a felhasználó beírt vagy a választóból kapott. Üres is lehet. */
  installedAt: string;
  /** Karbantartási intervallum napban, szövegként. Üres is lehet. */
  interval: string;
}

export interface AssetCreatePayload {
  ownerType: AssetOwnerType;
  ownerId: string;
  /** Csak szerviz partner tulajdonosnál kerül bele, lásd `buildAssetCreatePayload`. */
  departmentId?: string;
  kind: AssetKind;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installedAt?: string;
  serviceIntervalDays?: number;
}

export type AssetCreateResult =
  | { ok: true; payload: AssetCreatePayload }
  /** A `field` azt mondja meg, MELYIK mezőnél kell a hibát megmutatni. */
  | { ok: false; field: AssetCreateField; message: string };

export type AssetCreateField = "owner" | "name" | "installedAt" | "interval";

const DATE_SEPARATORS = /[.\-/\s]+/;

/**
 * ELFOGADÓ dátum-olvasás, egyetlen kimenettel.
 *
 * Amit elfogad: `2026-08-25`, `2026.08.25`, `2026.08.25.`, `2026/8/5`, tehát
 * mindazt, amit egy magyar felhasználó le szokott írni. Amit ad: mindig
 * `ÉÉÉÉ-HH-NN`, mert a szerver csak azt fogadja el.
 *
 * A megengedő olvasás NEM a szigor feladása: a szigor ott van, hogy a naptár
 * szerint NEM létező napot (`2026-02-30`) elutasítja. A `Date` konstruktor ezt
 * magától átfordítaná március 2-ára, és a felhasználó egy másik dátumot kapna
 * vissza, mint amit beírt -- csendben.
 */
export function normalizeAssetDate(
  value: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = value.trim().replace(/\.$/, "");
  if (!trimmed) return { ok: true, value: "" };

  const parts = trimmed.split(DATE_SEPARATORS).filter(Boolean);
  if (parts.length !== 3)
    return {
      ok: false,
      message: "A dátum éééé-hh-nn alakban kell (például 2026-08-25).",
    };

  const [year, month, day] = parts.map((part) => Number.parseInt(part, 10));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    parts.some((part) => !/^\d+$/.test(part))
  )
    return {
      ok: false,
      message: "A dátum éééé-hh-nn alakban kell (például 2026-08-25).",
    };

  if (year < 1900 || year > 2999)
    return { ok: false, message: "Az évszám nem tűnik valódinak." };
  if (month < 1 || month > 12)
    return { ok: false, message: "A hónap 1 és 12 közé eshet." };
  if (day < 1 || day > daysInMonth(year, month))
    return {
      ok: false,
      message: `Ez a nap nem létezik: ${year}. ${month}. hónapjában ${daysInMonth(year, month)} nap van.`,
    };

  return {
    ok: true,
    value: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
  };
}

/**
 * A DÁTUMVÁLASZTÓ ÉS A MEZŐ KÖZÖTTI ÁTVÁLTÁS, mind a két irányban.
 *
 * A választó `Date` objektummal dolgozik, a mező és a kérés `ÉÉÉÉ-HH-NN`
 * szöveggel. A csapda a `toISOString()`: az UTC-ben ír, tehát egy budapesti
 * éjfélkor kezdődő nap NÁLUNK az ELŐZŐ nap 22 órája, és a felhasználó egy
 * nappal korábbi dátumot kapna vissza, mint amit kiválasztott. Ezért a helyi
 * év/hónap/nap hármast olvassuk ki, nem az UTC-alakot.
 */
export function dateInputValue(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(
    date.getDate(),
    2,
  )}`;
}

/**
 * A választó kezdőértéke. DÉLBEN áll, nem éjfélkor: az óraátállítás napján egy
 * éjfél előre-hátra ugorhat, és abból megint egy nappal odébb csúszó dátum lesz.
 * Ha a mező üres vagy értelmezhetetlen, a mai nap az ajánlat.
 */
export function dateFromInput(value: string, today: Date = new Date()): Date {
  const normalized = normalizeAssetDate(value);
  if (!normalized.ok || !normalized.value) return today;
  const [year, month, day] = normalized.value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12, 0, 0, 0);
}

/**
 * Amit a képernyő elküld, vagy az EGYETLEN ok, amiért nem küldi el.
 *
 * Nincs olyan ág, ami némán tér vissza: minden elutasítás megnevezi a mezőt és
 * ad egy magyar mondatot. Egy néma gomb ugyanaz a hibaosztály, mint egy üres
 * válasz, ami nem mondja meg magáról, miért üres.
 */
export function buildAssetCreatePayload(
  form: AssetCreateForm,
): AssetCreateResult {
  if (!form.owner)
    return {
      ok: false,
      field: "owner",
      message: "Válassz partnert a lista tetején.",
    };

  const name = form.name.trim();
  if (!name)
    return {
      ok: false,
      field: "name",
      message: "Az eszköz neve kötelező.",
    };

  const installed = normalizeAssetDate(form.installedAt);
  if (!installed.ok)
    return { ok: false, field: "installedAt", message: installed.message };

  const intervalText = form.interval.trim();
  let serviceIntervalDays: number | undefined;
  if (intervalText) {
    if (!/^\d+$/.test(intervalText))
      return {
        ok: false,
        field: "interval",
        message: "A karbantartási intervallum csak szám lehet, napban.",
      };
    serviceIntervalDays = Number.parseInt(intervalText, 10);
    if (serviceIntervalDays < 1 || serviceIntervalDays > 3650)
      return {
        ok: false,
        field: "interval",
        message: "A karbantartási intervallum 1 és 3650 nap közé essen.",
      };
  }

  return {
    ok: true,
    payload: {
      ownerType: form.owner.type,
      ownerId: form.owner.id,
      /**
       * AZ ALEGYSÉG CSAK SZERVIZ PARTNERNÉL MEGY KI.
       *
       * Vevő tulajdonosnál a szerver elutasítaná, és a hiba a mentés
       * pillanatában jelenne meg, azután, hogy a szerelő mindent kitöltött. A
       * választó ilyenkor meg sem jelenik a képernyőn, de a mező a formban
       * ottmaradhat egy korábbi választásból: a tulajdonos váltása nem törli
       * automatikusan azt, amit a felhasználó egyszer már beírt. Ezért itt a
       * TULAJDONOS TÍPUSA dönt, nem az, hogy van-e érték.
       */
      ...(form.owner.type === "SUPPLIER" && form.unitId.trim()
        ? { departmentId: form.unitId.trim() }
        : {}),
      kind: form.kind,
      name,
      manufacturer: form.manufacturer.trim() || undefined,
      model: form.model.trim() || undefined,
      serialNumber: form.serialNumber.trim() || undefined,
      /**
       * A nap KEZDETE, UTC-ben. A telepítés dátuma nap-pontosságú adat: az
       * időpont-rész nem mérés, hanem a formátum ára, ezért nulla.
       */
      installedAt: installed.value
        ? `${installed.value}T00:00:00.000Z`
        : undefined,
      serviceIntervalDays,
    },
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}
