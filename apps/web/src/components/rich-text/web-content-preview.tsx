import {
  escapeHtml,
  isAllowedFullImageSrc,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import { useMemo } from "react";

/**
 * AZ ELO ELONEZET ALAPJA A TELJES PROFILU TARTALOMHOZ (Balazs kerese,
 * 2026-10-25 21:13 UTC, Discord fo csatorna, msg 1564024005932093531:
 * szerkesztes kozben latszodjon a kesz oldal).
 *
 * UGYANAZ A TISZTITO FUT, MINT A SZERVEREN (`profile: "full"`), tehat az
 * elonezet azt mutatja, ami a mentes utan tarolodik, nem azt, ami a
 * szerkesztoben all. A negy hely (kezdolap blokk, termekleiras, blogcikk,
 * ReefClub cikk) a sajat keretet (oldal-fej, blokk-sor) ez kore rajzolja; ez a
 * fajl csak a tartalom kirajzolasat adja.
 */

/** Egy termekkartya megjelenitesehez kello adat. */
export interface PreviewProductCard {
  readonly id: string;
  readonly name: string;
  readonly priceLabel: string | null;
  readonly imageUrl: string | null;
}

const TERMEKKARTYA = /<div data-product-card="([a-z0-9]+)">([\s\S]*?)<\/div>/g;

function kartyaHtml(
  azonosito: string,
  tartalekNev: string,
  kartya: PreviewProductCard | undefined,
): string {
  if (!kartya)
    return `<div data-preview-card="${azonosito}" data-preview-missing=""><strong>${tartalekNev}</strong><span>A termék adatai betöltés alatt vagy nem elérhetők.</span></div>`;
  const kep =
    kartya.imageUrl && isAllowedFullImageSrc(kartya.imageUrl)
      ? `<img src="${escapeHtml(kartya.imageUrl)}" alt="">`
      : "";
  const ar = kartya.priceLabel
    ? `<span>${escapeHtml(kartya.priceLabel)}</span>`
    : "";
  return `<div data-preview-card="${azonosito}">${kep}<div><strong>${escapeHtml(kartya.name)}</strong>${ar}</div></div>`;
}

/**
 * A TAROLANDO HTML MEGJELENITESRE KESZ ALAKJA.
 *
 * Elobb a szerver tisztitoja fut, utana csak a TISZTITOTT kimenet alakul: a
 * termekkartya a feloldott adatbol (minden mezo escape-elve), a link uj lapon
 * nyilik, hogy az elonezetre kattintas ne vigye el a szerkesztot.
 */
export function renderWebContentHtml(
  html: string,
  kartyak: ReadonlyMap<string, PreviewProductCard>,
): string {
  return sanitizeRichHtml(html, { profile: "full" })
    .replace(TERMEKKARTYA, (_minta, azonosito: string, nev: string) =>
      kartyaHtml(azonosito, nev, kartyak.get(azonosito)),
    )
    .replace(/<a(?=[\s>])/g, '<a target="_blank" rel="noopener noreferrer"');
}

/** A szoveg tipografiaja; a kirakat `prose prose-sm` + tablazat-savozas kozelitese. */
export const WEB_CONTENT_HTML_CLASS =
  "text-sm leading-6 text-pilot-grey-700 [&_a]:text-pilot-aqua-700 [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-pilot-grey-900 [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-pilot-grey-900 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li_p]:my-1 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-pilot-aqua-500 [&_blockquote]:pl-4 [&_blockquote]:italic [&_img]:max-w-full [&_img]:rounded [&_hr]:my-6 [&_[data-align=center]]:text-center [&_[data-align=right]]:text-right [&_p[data-cta]_a]:inline-block [&_p[data-cta]_a]:rounded-md [&_p[data-cta]_a]:bg-pilot-aqua-700 [&_p[data-cta]_a]:px-6 [&_p[data-cta]_a]:py-3 [&_p[data-cta]_a]:font-semibold [&_p[data-cta]_a]:text-white [&_p[data-cta]_a]:no-underline [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-pilot-grey-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-pilot-grey-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tbody_tr:nth-child(odd)]:bg-pilot-grey-50 [&_td_p]:my-0 [&_th_p]:my-0 [&_[data-gallery]]:my-4 [&_[data-gallery]]:grid [&_[data-gallery]]:grid-cols-2 [&_[data-gallery]]:gap-2 sm:[&_[data-gallery]]:grid-cols-3 [&_[data-gallery]_img]:aspect-square [&_[data-gallery]_img]:w-full [&_[data-gallery]_img]:object-cover [&_[data-preview-card]]:my-4 [&_[data-preview-card]]:flex [&_[data-preview-card]]:items-center [&_[data-preview-card]]:gap-3 [&_[data-preview-card]]:rounded-lg [&_[data-preview-card]]:border [&_[data-preview-card]]:border-pilot-grey-200 [&_[data-preview-card]]:p-3 [&_[data-preview-card]_img]:size-16 [&_[data-preview-card]_img]:object-cover [&_[data-preview-card]_div]:flex [&_[data-preview-card]_div]:flex-col [&_[data-preview-card]_span]:text-pilot-grey-500 [&_[data-preview-missing]]:flex-col [&_[data-preview-missing]]:items-start";

/**
 * A TARTALOM ELONEZETE: a tisztitott, megjelenitesre kesz HTML a kozos
 * tipografiaval. Ures tartalomra a hivo altal adott szoveget mutatja.
 */
export function WebContentPreview(props: {
  readonly html: string;
  readonly cards?: ReadonlyMap<string, PreviewProductCard>;
  readonly emptyText?: string;
  readonly className?: string;
}) {
  const kesz = useMemo(
    () => renderWebContentHtml(props.html, props.cards ?? new Map()),
    [props.html, props.cards],
  );
  const ures =
    !kesz.replace(/<[^>]*>/g, "").trim() &&
    !/<img|data-preview-card/.test(kesz);
  return ures ? (
    <p className="text-sm text-pilot-grey-500">
      {props.emptyText ?? "Még nincs tartalom."}
    </p>
  ) : (
    <div
      data-testid="web-content-preview-body"
      className={`${WEB_CONTENT_HTML_CLASS} ${props.className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: kesz }}
    />
  );
}
