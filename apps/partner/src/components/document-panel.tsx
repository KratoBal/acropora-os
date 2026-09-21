"use client";

import { useEffect, useRef, useState } from "react";

import { Message } from "./ticket-list";

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
    <section className="panel document-panel">
      <h2>{title}</h2>
      {items.length ? (
        <div className="document-grid">
          {items.map((item) => (
            <article key={item.id} className="document-card">
              {urls[item.id] ? (
                /*
                  A CSEMPE GOMB, NEM PUSZTA KÉP. A nagyítás így billentyűzetről
                  is elérhető, és a képernyőolvasó is műveletnek mondja -- egy
                  `onClick` a `<img>`-en mindkettőt elvenné.
                */
                <button
                  type="button"
                  className="document-thumb"
                  onClick={() => setNagyitott(item.id)}
                  aria-label={`${item.fileName} megnyitása nagyban`}
                >
                  <img
                    src={urls[item.id]}
                    alt={item.caption ?? item.fileName}
                  />
                </button>
              ) : (
                <p>{item.fileName}</p>
              )}
              <strong>{item.fileName}</strong>
              {item.caption ? <span>{item.caption}</span> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">Még nincs feltöltött fénykép vagy fájl.</p>
      )}
      <form className="document-upload" onSubmit={submit}>
        <label>
          Fájl
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Felirat
          <input
            value={caption}
            maxLength={1000}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Mit láthatunk a képen?"
          />
        </label>
        <button type="submit" disabled={!file || uploading}>
          {uploading ? "Feltöltés…" : "Fájl feltöltése"}
        </button>
      </form>
      {error ? <Message tone="error" text={error} /> : null}
      {nagyitott && urls[nagyitott] ? (
        <div
          className="image-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Nagyított kép"
          onClick={() => setNagyitott(null)}
        >
          <img src={urls[nagyitott]} alt={nagyitottNeve(items, nagyitott)} />
          <button type="button" onClick={() => setNagyitott(null)}>
            Bezárás
          </button>
        </div>
      ) : null}
    </section>
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
