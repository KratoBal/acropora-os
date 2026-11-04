import type { PilotBadgeVariant } from "@acropora/ui";
import { formatNumber } from "@acropora/types";
import type {
  PartnerOrderDocumentStepValue,
  PartnerOrderStatusValue,
  QuoteRichText,
} from "@acropora/types";

export const PARTNER_ORDERS_PATH = "/megrendelesek";

export const PARTNER_ORDER_STATUS: Record<
  PartnerOrderStatusValue,
  { label: string; variant: PilotBadgeVariant }
> = {
  OPEN: { label: "Nyitott", variant: "blue" },
  COMPLETED: { label: "Teljesítve", variant: "success" },
  INVOICED: { label: "Számlázva", variant: "success" },
  CANCELLED: { label: "Lemondva", variant: "grey" },
};

/** The chain step a document belongs to, in the order Luca's flow runs. */
export const PARTNER_ORDER_STEP: Record<
  PartnerOrderDocumentStepValue,
  { label: string; hint: string }
> = {
  INQUIRY: {
    label: "Ajánlatkérés",
    hint: "A megkeresés, amit az állatkerttől kaptunk.",
  },
  QUOTE: { label: "Ajánlat", hint: "Az elküldött ajánlat példánya." },
  SIGNED_ORDER_FORM: {
    label: "Aláírt megrendelőlap",
    hint: "Az állatkerttől kapott, aláírt megrendelőlap.",
  },
  COMPLETION: {
    label: "Teljesítésigazolás",
    hint: "Az állatkertnek elküldött teljesítésigazolás.",
  },
  SIGNED_COMPLETION: {
    label: "Aláírt teljesítésigazolás",
    hint: "A visszakapott, aláírt teljesítésigazolás. Ezután mehet a számla.",
  },
  INVOICE: { label: "Számla", hint: "A kiállított számla példánya." },
  OTHER: { label: "Egyéb", hint: "Minden más, ami a megrendeléshez tartozik." },
};

export const PARTNER_ORDER_STEP_ORDER: PartnerOrderDocumentStepValue[] = [
  "INQUIRY",
  "QUOTE",
  "SIGNED_ORDER_FORM",
  "COMPLETION",
  "SIGNED_COMPLETION",
  "INVOICE",
  "OTHER",
];

/** The four steps the list shows as "where the chain stands". */
export const PARTNER_ORDER_LIST_STEPS: Array<{
  step: PartnerOrderDocumentStepValue;
  label: string;
}> = [
  { step: "SIGNED_ORDER_FORM", label: "Megrendelőlap" },
  { step: "COMPLETION", label: "TIG" },
  { step: "SIGNED_COMPLETION", label: "Aláírt TIG" },
  { step: "INVOICE", label: "Számla" },
];

/** A quote line's rich text as plain lines (the order page shows it small, under the name). */
export function richTextPlain(value: QuoteRichText | null): string {
  if (!value) return "";
  const walk = (node: QuoteRichText): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    const inner = (node.content ?? []).map(walk);
    if (node.type === "paragraph" || node.type === "listItem")
      return `${inner.join("")}\n`;
    return inner.join("");
  };
  return walk(value)
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Display-only gross of a net amount; the totals block comes exact from the server, per VAT rate. */
export function grossOf(net: string, vatRatePercent: string): number {
  return Number(net) * (1 + Number(vatRatePercent) / 100);
}

export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
}
