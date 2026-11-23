import type { ContractKind } from "@acropora/types";

/**
 * EGY SZERZŐDÉSES TÉTEL TÖRÖLHETŐ-E (kártya c014db6f, Ág Luca bejelentése,
 * 2026-10-05). Tiszta függvények, hogy a szabály a képernyő nélkül is mérhető
 * legyen.
 *
 * A SZERVER A TÖRLÉST MÁR TUDJA: a `contracts.repository.ts` `update()`-je a
 * listából kimaradó tételt törli, a megmaradóké az azonosítóját megtartja. A
 * megrendelőlap-tétel viszont `onDelete: Restrict`-tel mutat a szerződéses
 * tételre, tehát egy olyan tétel törlése, amiből BÁRMILYEN megrendelőlap
 * készült (a visszavont is: a sora megmarad), 409-et ad. Ezt a felület előre
 * megmondja, ahelyett hogy a mentés hibára futna.
 */
export function contractItemsWithOrders(
  orders: readonly { items: readonly { contractItem: { id: string } }[] }[],
): Set<string> {
  return new Set(
    orders.flatMap((order) => order.items.map((item) => item.contractItem.id)),
  );
}

/**
 * MIÉRT NEM TÖRÖLHETŐ, vagy `null`, ha törölhető. A `locked` `null`, amíg a
 * megrendelőlapok nem töltődtek be: akkor nem tudjuk, ezért nem engedjük.
 */
export function contractItemRemovalBlocker(
  itemId: string,
  locked: ReadonlySet<string> | null,
  invoiced: ReadonlySet<string> = new Set(),
): string | null {
  if (locked === null) return "A megrendelőlapok betöltése folyamatban.";
  if (locked.has(itemId))
    return "Ehhez a tételhez már készült megrendelőlap, ezért nem törölhető.";
  // a számlasor a tételre mutat (feladat d510): a szerver is elutasítaná
  return invoiced.has(itemId)
    ? "Ehhez a tételhez már készült számla, ezért nem törölhető."
    : null;
}

/** A szerver tétel-szabálya (`contracts/dto.ts` `ContractItemDto`), előre. */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * KITÖLTÖTT-E A TÉTEL ÚGY, AHOGY A SZERVER ELFOGADJA. Ugyanaz a szabály az új
 * szerződés űrlapján és az adatlap szerkesztésekor (kártya c014db6f): enélkül
 * egy hibás mező az API angol üzenetével térne vissza.
 *
 * A FAJTA DÖNT (hétfői lista M4, a szerver `contracts.service.ts`
 * `normalize()`-ja): karbantartásnál az alkalom / év kötelező, beszerzésnél a
 * mennyiségi egység, és az alkalom nem számít.
 */
export function isValidContractItem(
  item: {
    description: string;
    unitNet: string;
    quantity: string;
    vatRatePercent: string;
    occasionsPerYear: string | number | null;
    unitOfMeasureId?: string | null;
  },
  kind: ContractKind = "MAINTENANCE",
): boolean {
  const common =
    item.description.trim() !== "" &&
    DECIMAL.test(item.unitNet) &&
    DECIMAL.test(item.quantity) &&
    DECIMAL.test(item.vatRatePercent);
  if (kind === "PURCHASE") return common && Boolean(item.unitOfMeasureId);
  const occasions = Number(item.occasionsPerYear);
  // a javítási tételnél az alkalom nem kötelező (felmérés S0/3), de ha van, érvényes legyen
  if (
    kind === "REPAIR" &&
    (item.occasionsPerYear === null || item.occasionsPerYear === "")
  )
    return common;
  return (
    common &&
    item.occasionsPerYear !== null &&
    Number.isInteger(occasions) &&
    occasions >= 1 &&
    occasions <= 366
  );
}

/** Az új, még el nem mentett tétel ideiglenes azonosítója az adatlapon. */
export const NEW_ITEM_PREFIX = "new-";
export const isUnsavedItem = (id: string) => id.startsWith(NEW_ITEM_PREFIX);

/**
 * A JAVÍTÁSI DÍJAK (kártya 3d80a18d, Balázs 2026-10-05; minta:
 * exchange/szerzodes-javitasi-dijak-minta-2026-10-05.png). Mind nem kötelező,
 * és NINCS számolás: a szorzó szerződésenként más, kézzel töltik (Luca). A minta
 * összesene sem a díjakból jön (90 súlyszám mellett 10 125 000 Ft).
 *
 * MINDEN DÍJ NETTÓ (Luca kérdésére, kártya 51898ed9, 2026-11-19): a felirat kimondja.
 */
export const REPAIR_FEE_FIELDS = [
  {
    key: "repairFeeWorkdayHours",
    label: "Munkanapon, munkaidőben (nettó Ft)",
    short: "munkaidőben",
    unit: " Ft",
  },
  {
    key: "repairFeeWorkdayOffHours",
    label: "Munkanapon, munkaidőn kívül (nettó Ft)",
    short: "munkaidőn kívül",
    unit: " Ft",
  },
  {
    key: "repairFeeHoliday",
    label: "Munkaszüneti és ünnepnapon (nettó Ft)",
    short: "munkaszüneti és ünnepnapon",
    unit: " Ft",
  },
  { key: "repairWeight", label: "Súlyszám", short: "súlyszám", unit: "" },
  {
    key: "repairTotal",
    label: "Összesen (nettó Ft)",
    short: "összesen",
    unit: " Ft",
  },
] as const;
export type RepairFeeKey = (typeof REPAIR_FEE_FIELDS)[number]["key"];
export type RepairFeeValues = Partial<Record<RepairFeeKey, string | null>>;

/** A beírt szám a szerver alakjára: szóköz nélkül, tizedespont. */
const normalizeAmount = (value: string) =>
  value.replace(/[\s ]/g, "").replace(",", ".");

/** Minden kitöltött díj szám-e (a szerver `Matches(DECIMAL)`-ja előre). */
export function repairFeesValid(item: RepairFeeValues): boolean {
  return REPAIR_FEE_FIELDS.every(({ key }) => {
    const value = item[key];
    return !value || !value.trim() || DECIMAL.test(normalizeAmount(value));
  });
}

/** A küldött alak: üres mező `null` (törli), a többi a szerver számalakjában. */
export function repairFeesPayload(
  item: RepairFeeValues,
): Record<RepairFeeKey, string | null> {
  return Object.fromEntries(
    REPAIR_FEE_FIELDS.map(({ key }) => {
      const value = item[key];
      return [key, value && value.trim() ? normalizeAmount(value) : null];
    }),
  ) as Record<RepairFeeKey, string | null>;
}

/** Az adatlap sora a kitöltött díjakból, vagy `null`, ha egy sincs kitöltve. */
export function repairFeeSummary(
  item: RepairFeeValues,
  format: (value: string) => string,
): string | null {
  const parts = REPAIR_FEE_FIELDS.flatMap(({ key, short, unit }) => {
    const value = item[key];
    return value && value.trim() ? [`${short} ${format(value)}${unit}`] : [];
  });
  return parts.length ? `Javítási díjak (nettó): ${parts.join(" · ")}` : null;
}

/**
 * A JAVÍTÁSI DÍJAK "ÖSSZESEN" MEZŐJE CSAK SÚLYSZÁMMAL SZERKESZTHETŐ (kártya 51898ed9, Balázs 2026-11-19): ahol súlyszám van, ott
 * az összeg nem számolt, hanem kézi marad; súlyszám nélkül a tétel összege a SZÁMOLT nettó (`contractItemAmounts`), és Luca
 * ezért írta a 450 000 Ft-ot a díjak közé. A mező súlyszám nélkül tiltott, DE A MEGLÉVŐ ÉRTÉKE NEM TŰNIK EL: a tiltott mező
 * mutatja, és a küldött alak (`repairFeesPayload`) változatlanul viszi, tehát egy mentés nem törli a kézi összeget.
 */
export function repairTotalState(item: RepairFeeValues): {
  editable: boolean;
  /** A magyarázat a mező alatt: súlyszám nélkül mindig, kiegészítve, ha kézi érték már áll benne. */
  hint: string | null;
} {
  const weight = item.repairWeight;
  if (weight && weight.trim()) return { editable: true, hint: null };
  const kept = item.repairTotal && item.repairTotal.trim();
  return {
    editable: false,
    hint: kept
      ? "A korábban kézzel beírt összeg megmarad, de súlyszám nélkül nem szerkeszthető. A tétel összege fent a számolt nettó."
      : "Súlyszám nélkül az összeg nem írható: a tétel összege fent a számolt nettó. Súlyszámmal kézzel adható meg.",
  };
}

/**
 * A TÉTEL SZÁMOLT ÖSSZEGE (kártya 51898ed9): nettó = egységár x darab x alkalom (beszerzésnél és az alkalom nélküli javítási
 * tételnél egységár x mennyiség), az ÁFA a KEREKÍTETT nettóból, a bruttó a kettő összege. UGYANAZ A SZABÁLY, mint a szerver
 * megrendelőlap-összegénél (`computeMaintenanceOrderFormItemAmounts`): négy tizedesre kerekítve, félre felfelé (`ROUND_HALF_UP`), tehát a képernyő
 * és a kiadott lap nem térhet el. A szorzás egész számokkal megy (`BigInt`), mert a `Number` szorzat egy 0,1 + 0,2 jellegű eltérést
 * pénzre vinne. Az eredmény tizedes SZÖVEG (négy tizedessel); a forintra kerekítés a megjelenítés dolga. `null`, ha egy szám még
 * nem érvényes (üres vagy félig beírt mező): a felület ilyenkor nem ír összeget.
 */
export function contractItemAmounts(
  item: {
    unitNet: string;
    quantity: string;
    vatRatePercent: string;
    occasionsPerYear: string | number | null;
  },
  kind: ContractKind = "MAINTENANCE",
): { net: string; vat: string; gross: string } | null {
  const unit = parseScaled(item.unitNet);
  const quantity = parseScaled(item.quantity);
  const rate = parseScaled(item.vatRatePercent);
  if (!unit || !quantity || !rate) return null;
  let occasions = 1n;
  if (kind !== "PURCHASE") {
    const raw = item.occasionsPerYear;
    const given = raw !== null && String(raw).trim() !== "";
    if (given) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 366) return null;
      occasions = BigInt(n);
    } else if (kind !== "REPAIR") {
      // karbantartásnál az alkalom kötelező: nélküle nincs összeg
      return null;
    }
  }
  const net = roundHalfUp(
    unit.value * quantity.value * occasions,
    unit.scale + quantity.scale,
    MONEY_SCALE,
  );
  const vat = roundHalfUp(
    net * rate.value,
    MONEY_SCALE + rate.scale + 2,
    MONEY_SCALE,
  );
  return {
    net: formatScaled(net, MONEY_SCALE),
    vat: formatScaled(vat, MONEY_SCALE),
    gross: formatScaled(net + vat, MONEY_SCALE),
  };
}

const MONEY_SCALE = 4;

/** Egy tizedes SZÖVEG egész számként és tizedes-számmal; `null`, ha nem szám (a szerver `DECIMAL`-ja, vesszővel is). */
function parseScaled(text: string): { value: bigint; scale: number } | null {
  const normalized = normalizeAmount(text);
  if (!DECIMAL.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return { value: BigInt(whole! + fraction), scale: fraction.length };
}

/** `value` (tizedes-számmal `from`) a `to` tizedesre, félre felfelé (csak nemnegatív érték: a szerver `DECIMAL`-ja sem enged mást). */
function roundHalfUp(value: bigint, from: number, to: number): bigint {
  if (from <= to) return value * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const quotient = value / divisor;
  return (value % divisor) * 2n >= divisor ? quotient + 1n : quotient;
}

function formatScaled(value: bigint, scale: number): string {
  const text = value.toString().padStart(scale + 1, "0");
  return `${text.slice(0, text.length - scale)}.${text.slice(text.length - scale)}`;
}
