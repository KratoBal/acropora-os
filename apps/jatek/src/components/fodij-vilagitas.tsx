"use client";

import { useState } from "react";

/**
 * A VILAGITAS SZAKASZ KAPCSOLOJA (az eredeti oldal mukodese szerint): nappal egy kep; ejszaka az ejszakai kep, es ket
 * tulajdonsag ("Allithato fenyero", "Kek es RGB csatornak"), amelyekre valtva a fenyero- es az RGB-elonezet latszik.
 * A kepek a szerverrol jonnek ugyanabban a sorrendben, nincs szamitas: csak a latszo kep valtozik.
 */
type Nezet = "nappal" | "ejszaka" | "fenyero" | "rgb";

const KEPEK: Record<Nezet, { src: string; alt: string; felirat: string }> = {
  nappal: {
    src: "/fodij/vilagitas-nappal.webp",
    alt: "Világos nappali, benne egy kis tengervizes akvárium a fekete szekrényén, délutáni fényben.",
    felirat: "Gyönyörű fények nappal",
  },
  ejszaka: {
    src: "/fodij/vilagitas-ejszaka.webp",
    alt: "Ugyanaz a nappali éjszaka, az akvárium kék fénnyel világít a sötét szobában.",
    felirat: "Megnyugtató óceáni látvány éjszaka",
  },
  fenyero: {
    src: "/fodij/vilagitas-fenyero.webp",
    alt: "A nappali éjszaka, lecsökkentett fényerejű akváriumvilágítással.",
    felirat: "Megnyugtató óceáni látvány éjszaka",
  },
  rgb: {
    src: "/fodij/vilagitas-rgb.webp",
    alt: "A nappali éjszaka, az akvárium kék és RGB csatornákkal beállított világításával.",
    felirat: "Megnyugtató óceáni látvány éjszaka",
  },
};

export function FodijVilagitas() {
  const [nezet, setNezet] = useState<Nezet>("nappal");
  const ejszaka = nezet !== "nappal";
  const kep = KEPEK[nezet];

  return (
    <div className="fodij-vilagitas">
      <p className="fodij-felirat">{kep.felirat}</p>
      <div
        className="fodij-kapcsolo"
        role="group"
        aria-label="Nappal / Éjszaka"
      >
        <button
          type="button"
          aria-pressed={!ejszaka}
          onClick={() => setNezet("nappal")}
        >
          NAPPAL
        </button>
        <button
          type="button"
          aria-pressed={ejszaka}
          onClick={() => setNezet("ejszaka")}
        >
          ÉJSZAKA
        </button>
      </div>
      <div className="fodij-vilagitas-kep">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={kep.src} alt={kep.alt} loading="lazy" decoding="async" />
      </div>
      {ejszaka ? (
        <ul className="fodij-tulajdonsagok">
          <li>
            <button
              type="button"
              aria-pressed={nezet === "fenyero"}
              onClick={() =>
                setNezet(nezet === "fenyero" ? "ejszaka" : "fenyero")
              }
            >
              Állítható fényerő
            </button>
          </li>
          <li>
            <button
              type="button"
              aria-pressed={nezet === "rgb"}
              onClick={() => setNezet(nezet === "rgb" ? "ejszaka" : "rgb")}
            >
              Kék és RGB csatornák
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
