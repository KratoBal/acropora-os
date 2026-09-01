"use client";

import { Alert, Skeleton } from "@acropora/ui";
import type { ContentDetail } from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";

/**
 * EGY TÉTEL SZÖVEGE ÉS A BESZÉLGETÉSE, A SOR ALATT.
 *
 * MIÉRT KELLETT, ÉS MI VOLT NÉLKÜLE: 2026-09-01-én mérve, a felület egyetlen
 * hívása sem kérte le a `detail` végpontot. A képesség megvolt -- a végpont
 * visszaadja a szöveget és a hozzászólásokat időrendben --, csak nem volt
 * bekötve. Ettől a sor MŰKÖDÖTT és a menet mégsem: aki jóváhagy, nem tudta
 * elolvasni, MIT hagy jóvá, aki javít, nem látta, mit kértek tőle.
 *
 * A második fele a rosszabb. A visszaküldés felvetése aznap délután került a
 * tétel alá hozzászólásként, azzal az indokkal, hogy „ott álljon, ahol a válasz
 * is lesz" -- és nem volt hely, ahol látszik.
 *
 * MIÉRT A SOR ALATT, ÉS NEM KÜLÖN OLDAL: a belépési pont a „mi vár rám" lista,
 * és onnan elnavigálni azt jelentené, hogy a döntés után vissza kell találni.
 * A sor alatt kinyíló szakasz ugyanaz az alak, mint az elvetés okáé és a
 * hozzászólásé -- nem új szerkezet, csak több belőle.
 *
 * AMI SZÁNDÉKOSAN NINCS BENNE: írás. A hozzászólás küldése a soron marad, egy
 * helyen, mert két író út ugyanahhoz az adathoz pontosan az, amitől a mai
 * duplák elromlottak.
 */
export function ContentDetailPanel({ id }: { id: string }) {
  const { session } = useAuth();
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const token = session?.token ?? "";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    contentApi
      .detail(token, id, controller.signal)
      .then((value) => setDetail(value))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error ? cause.message : "A tétel nem tölthető be.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, token]);

  if (loading) return <Skeleton className="h-24" />;

  // HÁROM ÁLLAPOT VAN, NEM KETTŐ: van adat, nincs adat, és NEM TUDJUK. A hibát
  // sosem mutatjuk üres tartalomként -- ugyanaz a szabály, mint a listánál, és
  // ugyanabból a hibából: egy sikerként megjelenített hiba megnyugtat.
  if (error)
    return (
      <Alert
        variant="danger"
        title="A tétel nem tölthető be"
        description={error}
      />
    );

  if (!detail) return null;

  return (
    <div className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <section>
        <h4 className="text-xs font-semibold uppercase text-slate-500">
          A szöveg
        </h4>
        {detail.body?.trim() ? (
          // A SORTÖRÉSEK MEGMARADNAK. Egy bekezdésekre tagolt poszt egyetlen
          // folyammá olvasztva mást mond, mint amit a szerző írt -- és épp ezt
          // a szöveget kell valakinek jóváhagynia.
          <p className="whitespace-pre-wrap text-sm">{detail.body}</p>
        ) : (
          <p className="text-sm text-slate-500">
            Ehhez a tételhez még nincs szöveg.
          </p>
        )}
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase text-slate-500">
          Beszélgetés ({detail.comments.length})
        </h4>
        {detail.comments.length === 0 ? (
          <p className="text-sm text-slate-500">Még nincs hozzászólás.</p>
        ) : (
          <ul className="space-y-2">
            {detail.comments.map((comment) => (
              <li key={comment.id} className="text-sm">
                <span className="text-xs text-slate-500">
                  {new Date(comment.createdAt).toLocaleString("hu-HU")}
                </span>
                {/*
                  A FELVETÉS ÉS A VÁLASZ EGY FOLYAMBAN, IDŐRENDBEN. Ma nincs
                  szál-szerkezet, és az egy tudatos döntés: egy lektor, egy
                  szerző és egy kör mellett az időrend megmutatja, mi mire
                  válasz. A szálasítás akkor jön, ha egy tételen három nyitott
                  felvetés áll egyszerre (kártya: c057b4db).
                */}
                <p className="whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.imageRequired ? (
        <section>
          <h4 className="text-xs font-semibold uppercase text-slate-500">
            Kép
          </h4>
          <p className="text-sm">
            {detail.imageAttachedAt
              ? `Megvan (${new Date(detail.imageAttachedAt).toLocaleDateString("hu-HU")})`
              : "Még hiányzik. A feltöltés ma nem ezen a felületen történik."}
          </p>
        </section>
      ) : null}
    </div>
  );
}
