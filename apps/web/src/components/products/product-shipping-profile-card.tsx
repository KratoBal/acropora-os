"use client";

import {
  Alert,
  Button,
  PilotDataGrid,
  PilotDataItem,
  PilotSection,
  PilotButton,
} from "@acropora/ui";
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
  {
    // a82ed229: a UNAS nem ismeri, tehát mindig kézi
    key: "lockerUnsuitable" as const,
    label: "Csomagautomatába nem fér",
    // barracuda, #2202: the shop does not act on it yet (the storefront slice of a82ed229), so the hint says so
    hint: "A kirakatban (következő lépés): Foxpost nem ajánlható, GLS csomagponton csak bolt.",
  },
];

/**
 * JELZŐNKÉNT A FORRÁS (a82ed229, #1654): a négy régi jelzőt a UNAS-szinkron tölti, és amit valaki kézzel átír, az
 * onnantól kézi, a szinkron nem írja felül. Az új jelzőt a UNAS nem ismeri, az mindig kézi. Ha egy válasz még nem
 * hozza a forrást (régi szerver), a kártya nem talál ki semmit, egyszerűen nem írja ki.
 */
function sourceText(
  profile: ProductShippingProfileDetail,
  key: (typeof JELZOK)[number]["key"],
): string | null {
  if (key === "lockerUnsuitable") return "kézzel";
  const source = profile.sources?.[key];
  return source === "UNAS"
    ? "UNAS szerint"
    : source === "MANUAL"
      ? "kézzel"
      : null;
}

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
            lockerUnsuitable: profile.lockerUnsuitable ?? false,
          }
        : {
            pickupOnly: false,
            foxpostForbidden: false,
            isHeavy: false,
            isFrozen: false,
            lockerUnsuitable: false,
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
    <PilotSection
      title="Szállítási jellemzők"
      subtitle="A UNAS-ból töltődik; amit kézzel átírsz, azt a szinkron többé nem írja felül"
      action={
        canManage && !draft && loaded ? (
          <Button variant="secondary" size="sm" onClick={szerkesztesKezdese}>
            {profile ? "Módosítás" : "Kitöltés"}
          </Button>
        ) : undefined
      }
      bodyClassName="space-y-3 px-5 py-5"
    >
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      {!loaded ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : draft ? (
        <div className="space-y-2">
          {JELZOK.map((jelzo) => (
            <label
              key={jelzo.key}
              className="flex items-start gap-2 text-sm text-dusk-700"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={draft[jelzo.key] ?? false}
                onChange={(event) =>
                  setDraft({ ...draft, [jelzo.key]: event.target.checked })
                }
              />
              <span>
                <span className="font-medium">{jelzo.label}</span>
                <span className="block text-xs text-dusk-500">
                  {jelzo.hint}
                </span>
              </span>
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <PilotButton disabled={busy} onClick={() => void mentes()}>
              Mentés
            </PilotButton>
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Mégsem
            </PilotButton>
          </div>
        </div>
      ) : profile ? (
        <PilotDataGrid columns={4}>
          {JELZOK.map((jelzo) => {
            const source = sourceText(profile, jelzo.key);
            return (
              <PilotDataItem key={jelzo.key} label={jelzo.label}>
                {profile[jelzo.key] ? "Igen" : "Nem"}
                {source ? (
                  <span className="ml-1 text-xs text-pilot-grey-500">
                    · {source}
                  </span>
                ) : null}
              </PilotDataItem>
            );
          })}
        </PilotDataGrid>
      ) : (
        /*
          A HIANYZO PROFIL SAJAT MONDATOT KAP, nem negy kikapcsolt kapcsolot.
          Egy "minden nem" latszat itt hamis allitas lenne: azt sugallna, hogy
          valaki megnezte a terméket es ugy dontott, hogy egyik jelzo sem all ra.
        */
        <p className="text-sm text-pilot-grey-500">
          Még senki nem vizsgálta meg ezt a terméket.
        </p>
      )}
    </PilotSection>
  );
}
