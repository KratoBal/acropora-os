/**
 * A státuszkódok magyar címkéi.
 *
 * `as const`, ÉS NEM `Record<string, string>`, mert a második azt állította, hogy
 * BÁRMILYEN string kulcs létezik benne. Ez sosem volt igaz, csak nem látszott: két
 * hívási hely (`STATUS_LABEL.CANCELLED` és `.COMPLETED`) tartalék nélkül olvasott
 * ki egy kulcsot, és ha a táblát valaha átnevezik vagy generálják, ott CSENDBEN
 * `undefined` került volna a képernyőre -- üres címke, hibaüzenet nélkül.
 *
 * Így a fordító garantálja a két nevesített kulcsot, a `labelFor` pedig a
 * futásidejű esetet kezeli. A kettő nem ugyanaz a védelem, és mindkettő kell.
 */
const STATUS_LABEL = {
  DRAFT: "Piszkozat",
  PENDING: "Függőben",
  CONFIRMED: "Visszaigazolva",
  PICKING: "Szedés alatt",
  PACKED: "Csomagolva",
  SHIPPED: "Kiszállítva",
  COMPLETED: "Lezárva",
  CANCELLED: "Törölve",
  ON_HOLD: "Felfüggesztve",
} as const;

/**
 * A tábla által ISMERT státuszok, a táblából származtatva.
 *
 * Nem külön felsorolás: egy kézzel karbantartott második lista előbb-utóbb
 * elcsúszik attól, amit valójában címkézünk.
 */
type KnownOrderStatus = keyof typeof STATUS_LABEL;

function isKnownStatus(status: string): status is KnownOrderStatus {
  return status in STATUS_LABEL;
}

export type OrderStatusTone = "neutral" | "success" | "danger";

export interface OrderStatusPresentation {
  label: string;
  tone: OrderStatusTone;
}

export function orderStatusPresentation(order: {
  status: string;
  unasStatusLabel: string | null;
  unasDeletedAt: string | null;
}): OrderStatusPresentation {
  if (order.unasDeletedAt) {
    return { label: "Törölve a UNAS-ban", tone: "danger" };
  }
  if (order.status === "CANCELLED") {
    return {
      label: order.unasStatusLabel ?? STATUS_LABEL.CANCELLED,
      tone: "danger",
    };
  }
  if (order.status === "COMPLETED") {
    return {
      label: order.unasStatusLabel ?? STATUS_LABEL.COMPLETED,
      tone: "success",
    };
  }
  /**
   * A TARTALÉK ITT MARAD, ÉS NEM LUSTASÁG. A `status` a szerver adata, nem a mi
   * unionunk: egy új státuszkód bevezetése a szerveren nem töri meg a mobil
   * fordítását, viszont címke nélkül maradna. Ilyenkor a nyers kód látszik --
   * csúnya, de olvasható, és nem üres mező.
   *
   * A fenti típusszigorítás fordítási időben véd, ez futásidőben. Aki a kettőt
   * egymás alternatívájának nézi, az egyiket ki fogja venni.
   */
  return {
    label:
      order.unasStatusLabel ??
      (isKnownStatus(order.status) ? STATUS_LABEL[order.status] : order.status),
    tone: "neutral",
  };
}

export function formatMoney(value: string, currency: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat("hu-HU", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function formatOrderDate(order: {
  orderedAt: string | null;
  createdAt: string;
}): string {
  return formatDateTime(order.orderedAt ?? order.createdAt);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("hu-HU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
