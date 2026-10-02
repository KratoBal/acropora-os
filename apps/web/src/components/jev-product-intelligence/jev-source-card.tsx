"use client";

import type { ProductEvidenceEntry } from "@acropora/types";

import { JevPill } from "./jev-pill";
import {
  SOURCE_LABEL,
  formatDateTime,
  formatFieldValue,
  isInternalSource,
  safeSourceHref,
} from "./jev-presentation";

/** What kind of source it is, in one line (Figma 394:264). */
const SOURCE_DESCRIPTION: Record<ProductEvidenceEntry["sourceType"], string> = {
  MANUFACTURER_DOCUMENT: "Gyártói dokumentum",
  MANUFACTURER_PAGE: "Hivatalos weboldal",
  SUPPLIER_PAGE: "Beszállítói adat",
  SUPPLIER_DOCUMENT: "Beszállítói dokumentum",
  KNOWLEDGE_BASE: "Belső tudásbázis",
  OS_PRODUCT_MASTER: "Jelenlegi belső adat",
  UNAS_CURRENT: "Jelenlegi belső adat",
};

/**
 * SOURCE CARD (Figma 394:261): one source's reading of a field.
 *
 * Our own data (Acropora OS / UNAS) is always "BELSŐ ADAT": it can be shown,
 * it can never verify itself. An external source is "KÜLSŐ FORRÁS": the card
 * does not judge which source is right, so it does not say ELLENŐRZÖTT or
 * ÜTKÖZÉS per card (the conflict is the field's status, on the hero).
 * Only an http(s) reference becomes a link.
 */
export function JevSourceCard({ entry }: { entry: ProductEvidenceEntry }) {
  const internal = isInternalSource(entry.sourceType);
  const href = safeSourceHref(entry.sourceRef);
  return (
    <article
      aria-label={SOURCE_LABEL[entry.sourceType]}
      className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.5px] text-pilot-grey-500">
        {SOURCE_LABEL[entry.sourceType]}
      </p>
      <p className="break-words text-[28px] font-semibold leading-tight text-pilot-grey-900">
        {formatFieldValue(entry.value)}
      </p>
      <p className="text-sm leading-5 text-pilot-grey-600">
        {SOURCE_DESCRIPTION[entry.sourceType]}
      </p>
      <p className="text-xs leading-4 text-pilot-grey-500">
        {entry.retrievedAt
          ? formatDateTime(entry.retrievedAt)
          : "Lekérés ideje ismeretlen"}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <JevPill tone="neutral">
          {internal ? "BELSŐ ADAT" : "KÜLSŐ FORRÁS"}
        </JevPill>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-pilot-aqua-700 hover:underline"
          >
            Forrás megnyitása
          </a>
        ) : null}
      </div>
    </article>
  );
}
