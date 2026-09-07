"use client";

import { Alert, Button, Card } from "@acropora/ui";
import { useEffect, useState } from "react";

import {
  productApi,
  type ProductShippingProfileDetail,
  type ProductShippingProfileInput,
} from "@/lib/api/products";

/**
 * A KEZZEL GONDOZOTT SZALLITASI JELZOK.
 *
 * === A LEGFONTOSABB, AMIT EZ A KARTYA MEGMUTAT: A NEM VIZSGALT ALLAPOT ===
 *
 * Ha egy terméknek nincs profilja, az NEM azt jelenti, hogy egyik jelzo sem all
 * ra -- azt jelenti, hogy MEG SENKI NEM NEZTE MEG. A ketto kulonbsegen all az
 * egesz tabla alakja (nincs alapertelmezes egyik oszlopon sem), es ha a felulet
 * itt negy kikapcsolt kapcsolot mutatna, a kulonbseg pont ott veszne el, ahol
 * ember nezi.
 *
 * Ezert a kartya ket allapotot rajzol: "meg nem vizsgalt" es "megvizsgalt, ime
 * a negy ertek". A masodikban egy csupa-nem eset is LATHATO dontes.
 *
 * === MIERT LATSZIK AKKOR IS, HA NINCS MIT TENNI ===
 *
 * Ugyanaz az indok, mint a gazda-kartyanal: ha csak a kitoltott termekeknel
 * jelenne meg, a hianya ketertelmu lenne -- nem tudnank, hogy nincs jogunk
 * hozza, vagy nincs meg adat.
 */
const JELZOK = [
  {
    key: "pickupOnly" as const,
    label: "Csak üzletben vehető át",
    hint: "Az egész kosarat üzletben kell átvenni.",
  },
  {
    key: "foxpostForbidden" as const,
    label: "Foxpost nem ajánlható",
    hint: "A Foxpost nem jelenik meg szállítási módként.",
  },
  {
    key: "isHeavy" as const,
    label: "Nehéz áru",
    hint: "Kézzel jelölt, sosem a súlyból számolt.",
  },
  {
    key: "isFrozen" as const,
    label: "Fagyasztott",
    hint: "Nem szállítható, üzleti átvételként viselkedik.",
  },
];

export function ProductShippingProfileCard({
  token,
  productId,
  canManage,
}: {
  token: string;
  productId: string;
  canManage: boolean;
}) {
  const [profile, setProfile] = useState<ProductShippingProfileDetail | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<ProductShippingProfileInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let elhagyott = false;
    productApi
      .getShippingProfile(token, productId)
      .then((result) => {
        if (elhagyott) return;
        setProfile(result);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (elhagyott) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A szállítási jellemzők nem tölthetők be.",
        );
        setLoaded(true);
      });
    return () => {
      elhagyott = true;
    };
  }, [productId, token]);

  /**
   * A SZERKESZTES MIND A NEGY JELZOVEL INDUL, ES EZ NEM KENYELMI DONTES.
   *
   * A vegpont mind a negyet koveteli, mert egy reszleges iras csendben "nem"-re
   * allitana azt, amihez a szerkeszto nem nyult. Ha meg nincs profil, a
   * szerkesztes csupa nemmel indul -- de az MAR dontes lesz, amint a szerkeszto
   * elmenti.
   */
  const szerkesztesKezdese = () =>
    setDraft(
      profile
        ? {
            pickupOnly: profile.pickupOnly,
            foxpostForbidden: profile.foxpostForbidden,
            isHeavy: profile.isHeavy,
            isFrozen: profile.isFrozen,
          }
        : {
            pickupOnly: false,
            foxpostForbidden: false,
            isHeavy: false,
            isFrozen: false,
          },
    );

  const mentes = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      setProfile(await productApi.saveShippingProfile(token, productId, draft));
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A szállítási jellemzők mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Szállítási jellemzők
        </h2>
        {canManage && !draft && loaded ? (
          <Button variant="secondary" onClick={szerkesztesKezdese}>
            {profile ? "Módosítás" : "Kitöltés"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      {!loaded ? (
        <p className="text-sm text-slate-500">Betöltés…</p>
      ) : draft ? (
        <div className="space-y-2">
          {JELZOK.map((jelzo) => (
            <label
              key={jelzo.key}
              className="flex items-start gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={draft[jelzo.key]}
                onChange={(event) =>
                  setDraft({ ...draft, [jelzo.key]: event.target.checked })
                }
              />
              <span>
                <span className="font-medium">{jelzo.label}</span>
                <span className="block text-xs text-slate-500">
                  {jelzo.hint}
                </span>
              </span>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <Button disabled={busy} onClick={() => void mentes()}>
              Mentés
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Mégsem
            </Button>
          </div>
        </div>
      ) : profile ? (
        <ul className="space-y-1 text-sm text-slate-700">
          {JELZOK.map((jelzo) => (
            <li key={jelzo.key}>
              {jelzo.label}: {profile[jelzo.key] ? "igen" : "nem"}
            </li>
          ))}
        </ul>
      ) : (
        /*
          A HIANYZO PROFIL SAJAT MONDATOT KAP, nem negy kikapcsolt kapcsolot.
          Egy "minden nem" latszat itt hamis allitas lenne: azt sugallna, hogy
          valaki megnezte a terméket es ugy dontott, hogy egyik jelzo sem all ra.
        */
        <p className="text-sm text-slate-500">
          Még senki nem vizsgálta meg ezt a terméket.
        </p>
      )}
    </Card>
  );
}
