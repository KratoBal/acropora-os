"use client";

import { useState } from "react";
import type { ContentChannel } from "@acropora/types";

import { contentApi } from "@/lib/api/content";

/**
 * A BEMENET, AMI EDDIG HIÁNYZOTT.
 *
 * A menü nem hibás volt, hanem félkész: a modul nyolc végpontja mind olvas
 * vagy léptet, és a tárolóban álló létrehozó függvénynek nem volt hívója.
 * Balázs panasza szó szerint az volt, hogy „semmi nincs benne, vagyis nincs
 * benne adat".
 *
 * A CSATORNA KÖTELEZŐ, ÉS NINCS ALAPÉRTELMEZÉSE. Egy előre kiválasztott
 * csatorna azt jelentené, hogy a leggyakoribb választás beleíródik azokba a
 * tételekbe is, ahol senki nem gondolt rá -- és a csatorna később a
 * megjelenítést és az ütemezést is eldönti.
 *
 * A KÉP KÜLÖN JELÖLŐ, NEM ÁLLAPOT. Ez a modell döntése, nem ezé az űrlapé: egy
 * tétel egyszerre lehet jóváhagyott szövegű és képre váró, és a kettő
 * összevonása mindig az egyiket felejti el.
 */
const CSATORNAK: { ertek: ContentChannel; cimke: string }[] = [
  { ertek: "FACEBOOK_POST", cimke: "Facebook poszt" },
  { ertek: "FACEBOOK_AD", cimke: "Facebook hirdetés" },
  { ertek: "ARTICLE", cimke: "Cikk" },
  { ertek: "OTHER", cimke: "Egyéb" },
];

export function ContentCreateForm({
  token,
  onCreated,
  onCancel,
}: {
  token: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<ContentChannel | "">("");
  const [body, setBody] = useState("");
  const [imageRequired, setImageRequired] = useState(false);
  const [plannedFor, setPlannedFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kuldheto = title.trim().length > 0 && channel !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!kuldheto || saving) return;
    setSaving(true);
    setError(null);
    try {
      await contentApi.create(token, {
        title: title.trim(),
        channel: channel as ContentChannel,
        // AZ ÜRES MEZŐ NEM MEGY EL. Egy üres törzs nem ugyanaz, mint a törzs
        // hiánya: az első azt állítja, hogy valaki beírt egy üres szöveget.
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(imageRequired ? { imageRequired: true } : {}),
        ...(plannedFor
          ? { plannedFor: new Date(plannedFor).toISOString() }
          : {}),
      });
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A tétel nem menthető el.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Új tartalom felvétele">
      <h2>Új tartalom</h2>

      <label htmlFor="content-title">Cím</label>
      <input
        id="content-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <label htmlFor="content-channel">Csatorna</label>
      <select
        id="content-channel"
        value={channel}
        onChange={(e) => setChannel(e.target.value as ContentChannel)}
        required
      >
        <option value="">Válassz csatornát</option>
        {CSATORNAK.map((cs) => (
          <option key={cs.ertek} value={cs.ertek}>
            {cs.cimke}
          </option>
        ))}
      </select>

      <label htmlFor="content-body">Szöveg</label>
      <textarea
        id="content-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <label htmlFor="content-image-required">
        <input
          id="content-image-required"
          type="checkbox"
          checked={imageRequired}
          onChange={(e) => setImageRequired(e.target.checked)}
        />
        Kép kell hozzá
      </label>

      <label htmlFor="content-planned-for">Tervezett nap</label>
      <input
        id="content-planned-for"
        type="date"
        value={plannedFor}
        onChange={(e) => setPlannedFor(e.target.value)}
      />

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={!kuldheto || saving}>
        {saving ? "Mentés..." : "Felvétel"}
      </button>
      <button type="button" onClick={onCancel} disabled={saving}>
        Mégse
      </button>
    </form>
  );
}
