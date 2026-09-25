"use client";

import { useEffect, useRef, useState } from "react";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";

import { Message } from "./ticket-list";

/**
 * FIGMA 9. KÖR, PILOT-AQUA (2026-09-25).
 *
 * A `DocumentPanel` a hibajegy- (#1127), eszköz- (#1128) és munkalap-
 * adatlap (#1129) egyetlen közös, akkor még violet komponense volt --
 * mindhárom PR fejlécében kimondva maradt, mert egy három hívóhelyű,
 * akkor még csak részben érintett komponens átalakítása túlmutatott volna
 * az adott lapon. Most, hogy mind a három hívó már pilot-aqua, ez a kör
 * zárja le a törést: a `document-panel`/`document-grid`/`document-card`/
 * `document-thumb`/`document-upload`/`image-overlay` `globals.css`
 * szabályok és a `frame.tsx` `PANEL`/`PANEL_CIM` helyett `PilotCard`/
 * `PilotFormField`/`PilotInput`/`PilotButton` és Tailwind-osztályok.
 *
 * A VISELKEDÉS VÁLTOZATLAN: ugyanaz a kép-előnézet (saját `blob`+object URL
 * hívás, mert a böngésző `<img>` eleme nem küld Authorization fejlécet),
 * ugyanaz a nagyítható-csempe minta, ugyanaz a feltöltési űrlap. EGYETLEN
 * KOMPENZÁLÓ VÁLTOZÁS: a felirat mező natív `maxLength={1000}`-je a
 * `PilotInput`-nak nincs ilyen propja, ezért a korlátot az `onChange`
 * maga kényszeríti ki (`value.slice(0, 1000)`) -- ugyanaz a minta, mint a
 * munkalap-adatlap aláírókód-mezőjénél (#1129).
 */

type DocumentItem = {
  id: string;
  fileName: string;
  contentType: string;
  caption: string | null;
};

export function DocumentPanel<T extends DocumentItem>({
  title,
  items,
  loadBlob,
  upload,
  onUploaded,
}: {
  title: string;
  items: T[];
  loadBlob(id: string): Promise<Blob>;
  upload(file: File, caption: string): Promise<unknown>;
  onUploaded(): Promise<void>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /*
    A NAGYÍTOTT KÉP AZONOSÍTÓJA, nem maga a tétel: a lista újratöltődhet
    feltöltés után, és egy eltárolt objektum akkor egy már lecserélt sorra
    mutatna. Az azonosító a `urls` térképet is ugyanúgy feloldja.
  */
  const [nagyitott, setNagyitott] = useState<string | null>(null);
  const loader = useRef(loadBlob);
  loader.current = loadBlob;

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    void Promise.all(
      items
        .filter((item) => item.contentType.startsWith("image/"))
        .map(async (item) => {
          try {
            const url = URL.createObjectURL(await loader.current(item.id));
            created.push(url);
            if (active) setUrls((current) => ({ ...current, [item.id]: url }));
          } catch {
            // A failed image remains downloadable through the browser's file flow.
          }
        }),
    );
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [items]);

  /** A nagyított képet az Escape is bezárja, nem csak a háttérre kattintás. */
  useEffect(() => {
    if (!nagyitott) return;
    const kezelo = (esemeny: KeyboardEvent) => {
      if (esemeny.key === "Escape") setNagyitott(null);
    };
    window.addEventListener("keydown", kezelo);
    return () => window.removeEventListener("keydown", kezelo);
  }, [nagyitott]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await upload(file, caption);
      await onUploaded();
      setFile(null);
      setCaption("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A fájl nem tölthető fel.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <PilotCard>
      <PilotCardHeader title={title} />
      <div className="px-5 py-4">
        {items.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
            {items.map((item) => (
              <article key={item.id} className="flex flex-col gap-1.5">
                {urls[item.id] ? (
                  /*
                    A CSEMPE GOMB, NEM PUSZTA KÉP. A nagyítás így
                    billentyűzetről is elérhető, és a képernyőolvasó is
                    műveletnek mondja -- egy `onClick` a `<img>`-en
                    mindkettőt elvenné.
                  */
                  <button
                    type="button"
                    onClick={() => setNagyitott(item.id)}
                    aria-label={`${item.fileName} megnyitása nagyban`}
                    className="block cursor-zoom-in rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pilot-aqua-500 focus-visible:ring-offset-2"
                  >
                    <img
                      src={urls[item.id]}
                      alt={item.caption ?? item.fileName}
                      className="aspect-[4/3] w-full rounded-lg bg-pilot-grey-100 object-cover"
                    />
                  </button>
                ) : (
                  <p className="text-sm text-pilot-grey-500">{item.fileName}</p>
                )}
                <strong className="text-sm text-pilot-grey-700">
                  {item.fileName}
                </strong>
                {item.caption ? (
                  <span className="text-xs text-pilot-grey-400">
                    {item.caption}
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-pilot-grey-500">
            Még nincs feltöltött fénykép vagy fájl.
          </p>
        )}
        <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1 text-sm font-medium text-pilot-grey-700">
            Fájl
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="cursor-pointer text-sm text-pilot-grey-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-pilot-aqua-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-pilot-aqua-700"
            />
          </label>
          <PilotFormField label="Felirat">
            <PilotInput
              value={caption}
              onChange={(value) => setCaption(value.slice(0, 1000))}
              placeholder="Mit láthatunk a képen?"
            />
          </PilotFormField>
          <div>
            <PilotButton type="submit" disabled={!file || uploading}>
              {uploading ? "Feltöltés…" : "Fájl feltöltése"}
            </PilotButton>
          </div>
        </form>
        {error ? (
          <div className="mt-3">
            <Message tone="error" text={error} />
          </div>
        ) : null}
      </div>
      {nagyitott && urls[nagyitott] ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-pilot-grey-900/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Nagyított kép"
          onClick={() => setNagyitott(null)}
        >
          <img
            src={urls[nagyitott]}
            alt={nagyitottNeve(items, nagyitott)}
            className="max-h-[80vh] max-w-full rounded-lg object-contain sm:max-w-3xl"
          />
          <button
            type="button"
            onClick={() => setNagyitott(null)}
            className="cursor-pointer rounded-full bg-white px-5 py-2 text-sm font-bold text-pilot-grey-900"
          >
            Bezárás
          </button>
        </div>
      ) : null}
    </PilotCard>
  );
}

/*
  A NAGYÍTOTT KÉP SZÖVEGES NEVE. Külön függvény, mert a `null` azonosítót a
  hívó már kizárta, a tételt viszont meg kell keresni -- és egy hiányzó sor
  (időzítés: a lista újratöltődött alatta) nem dobhat kivételt egy megnyitott
  képnézőben.
*/
function nagyitottNeve<T extends DocumentItem>(items: T[], id: string): string {
  const tetel = items.find((item) => item.id === id);
  return tetel?.caption ?? tetel?.fileName ?? "Nagyított kép";
}
