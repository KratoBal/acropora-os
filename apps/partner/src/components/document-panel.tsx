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
                <img src={urls[item.id]} alt={item.caption ?? item.fileName} />
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
    </section>
  );
}
