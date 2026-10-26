"use client";

import {
  isAllowedFullImageSrc,
  sanitizeRichHtmlReport,
} from "@acropora/rich-text";
import type { ProductDetail, ProductListItem } from "@acropora/types";
import { Alert } from "@acropora/ui";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ProductPagePreview,
  type PreviewProductCard,
} from "@/components/rich-text/web-content-preview";
import { productApi } from "@/lib/api/products";

/**
 * A TERMEKLEIRAS SZERKESZTOJE A TELJES PROFILLAL, ELO ELONEZETTEL.
 *
 * Balazs dontese, 2026-10-25 22:30 UTC (msg 1564043552525389924): a teljes
 * szerkeszto negy helyre kerul, ez az elso. Az elonezet kerese: msg
 * 1564024005932093531.
 *
 * A KEP A TERMEK SAJAT KEPEI KOZUL VALASZTHATO, es csak az `https:` cimuek
 * kozul: a tisztito a teljes profilban mast nem enged at, tehat a valaszto ne
 * kinaljon olyat, ami a mentesnel eltunne.
 */

const KARTYA_AZONOSITO = /data-product-card="([a-z0-9]+)"/g;
/** Egyszerre ennyi termekkartya adatat toltjuk be; a tobbi tartalek-alakban latszik. */
const KARTYA_BETOLTES_FELSO_HATAR = 12;

const arCimke = (termek: Pick<ProductListItem, "grossPrice">) =>
  termek.grossPrice
    ? `${Number(termek.grossPrice).toLocaleString("hu-HU", {
        maximumFractionDigits: 0,
      })} Ft`
    : null;

const elonezetKartya = (termek: ProductListItem): PreviewProductCard => ({
  id: termek.id,
  name: termek.name,
  priceLabel: arCimke(termek),
  imageUrl: termek.thumbnail?.url ?? null,
});

type Panel = "image" | "gallery" | "productCard" | null;

export function ProductDescriptionEditor({
  token,
  product,
  value,
  onChange,
}: {
  token: string;
  product: ProductDetail;
  value: string;
  onChange: (html: string) => void;
}) {
  const szerkeszto = useRef<RichTextEditorHandle>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [galeriaValasztas, setGaleriaValasztas] = useState<string[]>([]);
  const [kereses, setKereses] = useState("");
  const [talalatok, setTalalatok] = useState<ProductListItem[]>([]);
  const [kartyak, setKartyak] = useState<
    ReadonlyMap<string, PreviewProductCard>
  >(() => new Map());
  const kertKartyak = useRef(new Set<string>());

  /*
    AMIT A SZERKESZTO NEM TUD MEGTARTANI, AZT A BETOLTESKOR KIMONDJUK. A UNAS-
    bol atvett leirasokban gyakori a `style`, a `div` es a `span`; ezeket a
    teljes profil sem tarolja. Az elso ertekbol szamoljuk, nem a mostanibol:
    a figyelmeztetes arrol szol, mi valtozik a MENTETTHEZ kepest.
  */
  const [elsoErtek] = useState(value);
  const elveszo = useMemo(
    () =>
      elsoErtek
        ? sanitizeRichHtmlReport(elsoErtek, { profile: "full" }).removed
        : [],
    [elsoErtek],
  );

  const kepek = useMemo(
    () =>
      product.images
        .filter((kep) => isAllowedFullImageSrc(kep.url))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [product.images],
  );

  /* A leirasban allo termekkartyak adata: egyszer kerjuk le mindet. */
  useEffect(() => {
    const azonositok = [...value.matchAll(KARTYA_AZONOSITO)]
      .map((m) => m[1] as string)
      .filter((id) => !kertKartyak.current.has(id))
      .slice(0, KARTYA_BETOLTES_FELSO_HATAR);
    for (const id of azonositok) {
      kertKartyak.current.add(id);
      void productApi
        .detail(token, id)
        .then((termek) =>
          setKartyak((elozo) => new Map(elozo).set(id, elonezetKartya(termek))),
        )
        .catch(() => {
          /* a kartya a tartalek-alakban marad; a hiba a kartyan latszik */
        });
    }
  }, [token, value]);

  useEffect(() => {
    if (panel !== "productCard" || kereses.trim().length < 2) {
      setTalalatok([]);
      return;
    }
    let aktiv = true;
    const idozito = setTimeout(() => {
      void productApi
        .list(token, { search: kereses.trim(), pageSize: 8 })
        .then((valasz) => {
          if (aktiv) setTalalatok(valasz.items);
        })
        .catch(() => {
          if (aktiv) setTalalatok([]);
        });
    }, 250);
    return () => {
      aktiv = false;
      clearTimeout(idozito);
    };
  }, [token, kereses, panel]);

  const kepGomb = (
    url: string,
    alt: string | null,
    kijelolt: boolean,
    onClick: () => void,
  ) => (
    <button
      key={url}
      type="button"
      aria-pressed={kijelolt}
      aria-label={alt ?? "Termékkép"}
      onClick={onClick}
      className={`overflow-hidden rounded border-2 ${kijelolt ? "border-pilot-aqua-600" : "border-transparent"}`}
    >
      <img src={url} alt="" className="size-16 object-cover" />
    </button>
  );

  return (
    <div className="space-y-3">
      {elveszo.length ? (
        <Alert
          variant="danger"
          title="A mostani leírás egy része nem marad meg"
          description={`A leírásban olyan formázás is van, amit a szerkesztő nem tud megtartani (${elveszo.join(", ")}). Ha a leírást módosítod és mented, ezek elvesznek; a szöveg megmarad.`}
        />
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <RichTextEditor
            ref={szerkeszto}
            profile="full"
            aria-label="Leírás"
            value={value}
            onChange={onChange}
            onImageRequest={kepek.length ? () => setPanel("image") : undefined}
            onGalleryRequest={
              kepek.length > 1
                ? () => {
                    setGaleriaValasztas([]);
                    setPanel("gallery");
                  }
                : undefined
            }
            onProductCardRequest={() => {
              setKereses("");
              setPanel("productCard");
            }}
          />
          {panel === "image" ? (
            <div
              role="group"
              aria-label="Kép választása"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-pilot-grey-200 p-2"
            >
              {kepek.map((kep) =>
                kepGomb(kep.url, kep.altText, false, () => {
                  szerkeszto.current?.insertImage({
                    src: kep.url,
                    alt: kep.altText ?? product.name,
                  });
                  setPanel(null);
                }),
              )}
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-xs text-pilot-grey-600"
              >
                Mégse
              </button>
            </div>
          ) : null}
          {panel === "gallery" ? (
            <div
              role="group"
              aria-label="Galéria képei"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-pilot-grey-200 p-2"
            >
              {kepek.map((kep) =>
                kepGomb(
                  kep.url,
                  kep.altText,
                  galeriaValasztas.includes(kep.url),
                  () =>
                    setGaleriaValasztas((elozo) =>
                      elozo.includes(kep.url)
                        ? elozo.filter((url) => url !== kep.url)
                        : [...elozo, kep.url],
                    ),
                ),
              )}
              <button
                type="button"
                disabled={galeriaValasztas.length < 2}
                onClick={() => {
                  szerkeszto.current?.insertGallery(
                    galeriaValasztas.map((url) => ({
                      src: url,
                      alt:
                        kepek.find((kep) => kep.url === url)?.altText ??
                        product.name,
                    })),
                  );
                  setPanel(null);
                }}
                className="rounded-md bg-pilot-aqua-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Galéria beszúrása ({galeriaValasztas.length})
              </button>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-xs text-pilot-grey-600"
              >
                Mégse
              </button>
            </div>
          ) : null}
          {panel === "productCard" ? (
            <div
              role="group"
              aria-label="Termék választása"
              className="space-y-2 rounded-lg border border-pilot-grey-200 p-2"
            >
              <input
                aria-label="Termék keresése"
                value={kereses}
                placeholder="Termék neve vagy cikkszáma"
                onChange={(event) => setKereses(event.target.value)}
                className="w-full rounded-md border border-pilot-grey-200 px-2 py-1 text-sm"
              />
              <ul className="space-y-1">
                {talalatok.map((termek) => (
                  <li key={termek.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setKartyak((elozo) =>
                          new Map(elozo).set(termek.id, elonezetKartya(termek)),
                        );
                        kertKartyak.current.add(termek.id);
                        szerkeszto.current?.insertProductCard({
                          id: termek.id,
                          name: termek.name,
                        });
                        setPanel(null);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-sm hover:bg-pilot-grey-50"
                    >
                      {termek.name}
                      {termek.primarySku ? (
                        <span className="ml-2 text-xs text-pilot-grey-500">
                          {termek.primarySku}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="text-xs text-pilot-grey-600"
              >
                Mégse
              </button>
            </div>
          ) : null}
        </div>
        <ProductPagePreview
          name={product.name}
          priceLabel={arCimke(product)}
          imageUrl={kepek[0]?.url ?? product.thumbnail?.url ?? null}
          html={value}
          cards={kartyak}
        />
      </div>
    </div>
  );
}
