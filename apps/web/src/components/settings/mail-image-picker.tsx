"use client";

import {
  RICH_TEXT_IMAGE_MAX_WIDTH,
  RICH_TEXT_IMAGE_SCHEME,
  richImageId,
} from "@acropora/rich-text";
import { Button } from "@acropora/ui";
import type { RichTextImage } from "@acropora/ui/rich-text-editor";
import { useCallback, useEffect, useMemo, useState } from "react";

import { mailImagesApi, type MailImage } from "@/lib/api/mail-images";

/**
 * A LEVELSABLON KEPEI (Balazs kerese, 2026-09-28 07:39 UTC: „jo lenne ha kepet
 * is lehetne beszurni. pl acropora log").
 *
 * A kep EGYSZER feltoltve tobb sablonba is beszurhato: a valaszto a mar
 * feltoltottek listajat mutatja, es ugyanaz a fajl masodszor feltoltve a
 * szerveren a meglevo kepet adja vissza.
 */

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const olvaso = new FileReader();
    olvaso.onload = () => resolve(String(olvaso.result));
    olvaso.onerror = () => reject(olvaso.error);
    olvaso.readAsDataURL(blob);
  });
}

/**
 * A KEPEK LISTAJA ES A MEGJELENITHETO CIMUK.
 *
 * A kep tartalma HITELESITETT vegponton jon, tehat a bongeszo egy `<img>`-bol
 * nem tudja betolteni. Ezert itt `data:` URL lesz belole, es azt kapja a
 * szerkeszto es az elonezet. A `data:` URL CSAK a megjelenitesre szol: a sablon
 * HTML-jeben a sajat hivatkozas all, es a tisztito a `data:` forrast kidobna.
 */
export function useMailImages(token: string) {
  const [images, setImages] = useState<MailImage[]>([]);
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const betolt = useCallback(
    async (kepek: readonly MailImage[]) => {
      const parok = await Promise.all(
        kepek.map(async (kep) => {
          try {
            return [
              kep.id,
              await dataUrl(await mailImagesApi.content(token, kep.id)),
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      setSources((elozo) => {
        const uj = new Map(elozo);
        for (const par of parok) if (par) uj.set(par[0], par[1]);
        return uj;
      });
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    mailImagesApi
      .list(token, { signal: controller.signal })
      .then((kepek) => {
        setImages(kepek);
        void betolt(kepek);
      })
      .catch((hiba: unknown) => {
        if (hiba instanceof DOMException && hiba.name === "AbortError") return;
        setError(
          hiba instanceof Error ? hiba.message : "A képek nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [token, betolt]);

  const upload = useCallback(
    async (file: File) => {
      const kep = await mailImagesApi.upload(token, file);
      setImages((elozo) => [kep, ...elozo.filter((k) => k.id !== kep.id)]);
      await betolt([kep]);
      return kep;
    },
    [token, betolt],
  );

  const resolve = useCallback(
    (src: string) => {
      const id = richImageId(src);
      return id ? sources.get(id) : undefined;
    },
    [sources],
  );

  return { images, sources, error, upload, resolve };
}

/**
 * A HTML MEGJELENITHETO MASA AZ ELONEZETHEZ: a sajat hivatkozas helyere a
 * betoltott `data:` cim kerul. A bemenet TISZTITOTT HTML (a `src` a tisztito
 * egyseges alakjaban all), tehat a minta megbizhato. Ami meg nincs betoltve,
 * hivatkozas marad -- a homokozoban az egy ures kep.
 */
export function withImageSources(
  html: string,
  sources: ReadonlyMap<string, string>,
): string {
  return html.replace(
    /(<img[^>]*\ssrc=")([^"]*)"/g,
    (egesz, eleje: string, src: string) => {
      const id = richImageId(src);
      const cim = id ? sources.get(id) : undefined;
      return cim ? `${eleje}${cim}"` : egesz;
    },
  );
}

export function MailImagePicker(props: {
  images: readonly MailImage[];
  sources: ReadonlyMap<string, string>;
  error: string | null;
  upload: (file: File) => Promise<MailImage>;
  onInsert: (image: RichTextImage) => void;
  onClose: () => void;
}) {
  const { images, sources, upload, onInsert, onClose } = props;
  const [valasztott, setValasztott] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [szelesseg, setSzelesseg] = useState("");
  const [feltoltes, setFeltoltes] = useState(false);
  const [hiba, setHiba] = useState<string | null>(null);

  const kep = useMemo(
    () => images.find((k) => k.id === valasztott) ?? null,
    [images, valasztott],
  );

  const kivalaszt = (k: MailImage) => {
    setValasztott(k.id);
    setSzelesseg(String(Math.min(k.width, RICH_TEXT_IMAGE_MAX_WIDTH)));
  };

  const feltolt = async (file: File | undefined) => {
    if (!file) return;
    setFeltoltes(true);
    setHiba(null);
    try {
      kivalaszt(await upload(file));
    } catch (e) {
      setHiba(e instanceof Error ? e.message : "A feltöltés nem sikerült.");
    } finally {
      setFeltoltes(false);
    }
  };

  const w = Number(szelesseg);
  const ervenyesSzelesseg =
    Number.isInteger(w) && w >= 1 && w <= RICH_TEXT_IMAGE_MAX_WIDTH;

  return (
    <div
      role="dialog"
      aria-label="Kép beszúrása"
      className="space-y-3 rounded-lg border border-dusk-200 bg-white p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-dusk-700">
          Új kép feltöltése
          <input
            aria-label="Kép feltöltése"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={feltoltes}
            onChange={(event) => void feltolt(event.target.files?.[0])}
            className="mt-1 block text-xs"
          />
        </label>
        <p className="text-xs text-dusk-500">
          PNG, JPG, GIF vagy WebP, legfeljebb 1 MB. Egyszer feltöltve minden
          sablonba beszúrható.
        </p>
      </div>
      {hiba || props.error ? (
        <p role="alert" className="text-xs text-rose-600">
          {hiba ?? props.error}
        </p>
      ) : null}

      {images.length ? (
        <ul
          aria-label="Feltöltött képek"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {images.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                aria-pressed={valasztott === k.id}
                onClick={() => kivalaszt(k)}
                className={
                  valasztott === k.id
                    ? "w-full rounded-md border-2 border-brand-500 p-1 text-left"
                    : "w-full rounded-md border border-dusk-200 p-1 text-left hover:border-brand-500"
                }
              >
                {sources.get(k.id) ? (
                  <img
                    src={sources.get(k.id)}
                    alt={k.fileName}
                    className="h-16 w-full object-contain"
                  />
                ) : (
                  <span className="block h-16" />
                )}
                <span className="block truncate text-xs text-dusk-700">
                  {k.fileName}
                </span>
                <span className="block text-[10px] text-dusk-500">
                  {k.width}×{k.height}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-dusk-500">Még nincs feltöltött kép.</p>
      )}

      {kep ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-dusk-700">
            Leírás (ha a kép nem jelenik meg, ez látszik)
            <input
              aria-label="A kép leírása"
              value={alt}
              placeholder="pl. Acropora logó"
              onChange={(event) => setAlt(event.target.value)}
              className="mt-1 block w-64 rounded-md border border-dusk-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-dusk-700">
            Szélesség (px, legfeljebb {RICH_TEXT_IMAGE_MAX_WIDTH})
            <input
              aria-label="A kép szélessége"
              inputMode="numeric"
              value={szelesseg}
              onChange={(event) => setSzelesseg(event.target.value)}
              className="mt-1 block w-24 rounded-md border border-dusk-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (!kep || !ervenyesSzelesseg) return;
            onInsert({
              src: `${RICH_TEXT_IMAGE_SCHEME}${kep.id}`,
              alt,
              width: w,
            });
            onClose();
          }}
          disabled={!kep || !ervenyesSzelesseg}
        >
          Beszúrás
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Mégse
        </Button>
      </div>
    </div>
  );
}
