const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Piszkozat",
  PENDING: "Függőben",
  CONFIRMED: "Visszaigazolva",
  PICKING: "Szedés alatt",
  PACKED: "Csomagolva",
  SHIPPED: "Kiszállítva",
  COMPLETED: "Lezárva",
  CANCELLED: "Törölve",
  ON_HOLD: "Felfüggesztve",
};

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
  return {
    label: order.unasStatusLabel ?? STATUS_LABEL[order.status] ?? order.status,
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
