import type {
  DashboardAquariumAlertsWidgetData,
  DashboardAttentionItem,
  DashboardIncomingInvoicesWidgetData,
  DashboardMaterialRequestsWidgetData,
  DashboardMissingInvoicesWidgetData,
  DashboardOverdueInvoicesWidgetData,
  DashboardServiceTicketsWidgetData,
  DashboardSettlementsWidgetData,
  DashboardStockReconciliationWidgetData,
  DashboardStockSyncOutboxWidgetData,
  DashboardWidgetId,
  DashboardWorksheetsWidgetData,
} from "@acropora/types";

/**
 * THE WIDGETS FIGYELMET IGÉNYEL READS, in display order. Each is loaded only
 * when the user may see that widget, through the same loader (and the same
 * permission check) as its own card.
 *
 * Deliberately NOT here: `supplier-matching` and the JEV shadow runs (a shadow
 * measurement is never a task), and the frozen webshop.
 */
export const ATTENTION_SOURCES = [
  "overdue-invoices",
  "missing-invoices",
  "incoming-invoices",
  "settlements",
  "worksheets",
  "material-requests",
  "service-tickets",
  "aquarium-alerts",
  "stock-reconciliation",
  "stock-sync-outbox",
] as const satisfies readonly DashboardWidgetId[];
export type AttentionSource = (typeof ATTENTION_SOURCES)[number];

const MONTHS = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];

/** `2026-09` → `2026. szeptember` */
export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const name = MONTHS[index - 1];
  return name ? `${year}. ${name}` : month;
}

const TONE_ORDER = { danger: 0, warning: 1, info: 2 } as const;

type Item = Omit<DashboardAttentionItem, "widgetId">;

/** The actionable figures of one widget's data; zero figures are dropped. */
export function attentionItemsOf(
  widgetId: AttentionSource,
  data: unknown,
): DashboardAttentionItem[] {
  return itemsOf(widgetId, data)
    .filter((item) => item.count > 0)
    .map((item) => ({ widgetId, ...item }));
}

/** Danger first, then warning, then info; within a tone the source order stays. */
export function sortAttentionItems(
  items: readonly DashboardAttentionItem[],
): DashboardAttentionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.index - b.index,
    )
    .map(({ item }) => item);
}

function itemsOf(widgetId: AttentionSource, data: unknown): Item[] {
  switch (widgetId) {
    case "overdue-invoices": {
      const d = data as DashboardOverdueInvoicesWidgetData;
      return [
        {
          key: "overdue",
          label: "Lejárt kimenő számla",
          count: d.overdue.count,
          href: "/penzugy/szamlazas",
          tone: "danger",
        },
      ];
    }
    case "missing-invoices": {
      const d = data as DashboardMissingInvoicesWidgetData;
      // one line per month, never summed (owner decision, 2026-10-02): the
      // previous month is to be closed for the accountant, the current one
      // is still filling up
      return d.months.map((month) => ({
        key: `missing:${month.month}`,
        label: `Hiányzó számla – ${monthLabel(month.month)}`,
        count: month.missing,
        href: "/penzugy/hianyzo-szamlak",
        tone: "warning",
      }));
    }
    case "incoming-invoices": {
      const d = data as DashboardIncomingInvoicesWidgetData;
      return [
        {
          key: "errors",
          label: "Hibás bejövő számla",
          count: d.navErrors + d.mailboxFailed,
          href: "/beszerzes/nav-szamlak",
          tone: "danger",
        },
        {
          key: "late-corrections",
          label: "Könyvelés utáni helyesbítés",
          count: d.lateCorrections,
          href: "/beszerzes/varhato",
          tone: "warning",
        },
      ];
    }
    case "settlements": {
      const d = data as DashboardSettlementsWidgetData;
      return [
        {
          key: "failed",
          label: "Elszámolás hiba vagy sikertelen szinkron",
          count: d.sources.reduce(
            (sum, s) =>
              sum + s.errors + (s.lastRun?.status === "FAILED" ? 1 : 0),
            0,
          ),
          href: "/penzugy/elszamolasok",
          tone: "danger",
        },
        {
          key: "review",
          label: "Ellenőrizendő elszámolás",
          count: d.sources.reduce((sum, s) => sum + s.needsReview, 0),
          href: "/penzugy/elszamolasok",
          tone: "warning",
        },
      ];
    }
    case "worksheets": {
      const d = data as DashboardWorksheetsWidgetData;
      return [
        {
          key: "not-sent",
          label: "Aláírásra vár, nincs elküldve",
          count: d.awaitingSignatureNotSent,
          href: "/szerviz/munkalapok",
          tone: "warning",
        },
      ];
    }
    case "material-requests": {
      const d = data as DashboardMaterialRequestsWidgetData;
      return [
        {
          key: "open",
          label: "Nyitott anyagigény",
          count: d.openCount,
          href: "/szerviz/anyagigenyek",
          tone: "info",
        },
      ];
    }
    case "service-tickets": {
      const d = data as DashboardServiceTicketsWidgetData;
      return [
        {
          key: "new",
          label: "Új hibajegy",
          count: d.byStatus.NEW ?? 0,
          href: "/szerviz/hibajegyek",
          tone: "warning",
        },
      ];
    }
    case "aquarium-alerts": {
      const d = data as DashboardAquariumAlertsWidgetData;
      return [
        {
          key: "out-of-range",
          label: "Tartományon kívüli vízérték",
          count: d.outOfRangeCount,
          href: "/akvariumok",
          tone: "danger",
        },
      ];
    }
    case "stock-reconciliation": {
      const d = data as DashboardStockReconciliationWidgetData;
      return [
        {
          key: "discrepancies",
          label: "Készlet-eltérés",
          count: d.count,
          href: "/keszlet-egyeztetes",
          tone: "warning",
        },
      ];
    }
    case "stock-sync-outbox": {
      const d = data as DashboardStockSyncOutboxWidgetData;
      return [
        {
          key: "dead-letter",
          label: "Elakadt készlet-szinkron",
          count: d.deadLetter,
          href: "/keszlet-kimenosor",
          tone: "danger",
        },
      ];
    }
  }
}
