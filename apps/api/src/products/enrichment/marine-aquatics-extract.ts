import type { ExtractedValue, PageStatement } from "./page-extract.js";

/**
 * WHAT A MARINE-AQUATICS.EU PRODUCT PAGE STATES, FROM ITS LABELLED DATA ROWS.
 *
 * marine-aquatics.eu publishes no JSON-LD and no microdata (measured
 * 2026-10-03 on eight product pages), so the structured-data reader finds
 * nothing there. Each product page does carry one fixed, labelled list:
 *
 *   <ul class="data-row">
 *     <li><span>EAN:</span> <strong>4025167901201</strong></li>
 *     <li><span>Hmotnost: </span> <strong>0,25 kg</strong></li>
 *     ...
 *
 * Only these rows are read, by their exact label; no prose, no table guessing.
 * Owner approval for this reader: Balázs 2026-10-03 06:45 UTC ("Ok").
 *
 * Two rows are deliberately NOT taken:
 * - `Katalogové číslo` is the shop's own code, not always the manufacturer's
 *   (Aquaforest KH Plus reads "Kh Plus 250"), so it cannot verify an MPN.
 * - `Výrobce` is sometimes the company, not the brand ("Tunze
 *   Aquarientechnik GmbH" next to the brand TUNZE).
 * `Hmotnost balení` is the packed weight, so only the bare `Hmotnost` counts.
 */
const DATA_ROW =
  /<ul\b[^>]*\bclass\s*=\s*["']data-row["'][^>]*>([\s\S]*?)<\/ul>/gi;
const ROW = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const LABELLED =
  /<span\b[^>]*>([\s\S]*?)<\/span>\s*<strong\b[^>]*>([\s\S]*?)<\/strong>/i;

const LABEL_FIELD: Readonly<Record<string, ExtractedValue["field"]>> = {
  ean: "ean",
  hmotnost: "weight",
};

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMarineAquaticsStatement(html: string): PageStatement {
  const lists = [...html.matchAll(DATA_ROW)];
  if (lists.length === 0) return { values: [], note: "NO_STRUCTURED_DATA" };
  // More than one product block on a page (a listing): we cannot tell which
  // one is ours, so nothing is taken.
  if (lists.length > 1) return { values: [], note: "AMBIGUOUS_PRODUCT" };
  const values = new Map<ExtractedValue["field"], ExtractedValue>();
  for (const row of lists[0]![1]!.matchAll(ROW)) {
    const cells = LABELLED.exec(row[1]!);
    if (!cells) continue;
    const label = plain(cells[1]!).replace(/:\s*$/, "").trim();
    const field = LABEL_FIELD[label.toLowerCase()];
    const raw = plain(cells[2]!);
    if (!field || !raw || values.has(field)) continue;
    values.set(field, {
      field,
      raw: raw.slice(0, 200),
      excerpt: `data-row "${label}" = ${JSON.stringify(raw.slice(0, 120))}`,
    });
  }
  return {
    values: [...values.values()],
    note: values.size ? null : "NO_VALUES",
  };
}
