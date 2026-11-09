import type { Kerdes, Kovetkezo, Nyeremeny } from "../lib/jatek-api.ts";
import { NEM_ELERHETO } from "../lib/uzenetek.ts";
import { AutoFrissit } from "./auto-frissit.tsx";
import { BeadasUrlap } from "./beadas-urlap.tsx";
import { Visszaszamlalo } from "./visszaszamlalo.tsx";

/** "2026-W46" -> "46. hét"; ami nem ilyen alaku, azt valtozatlanul adjuk. */
export const hetCimke = (week: string): string => {
  const m = /^\d{4}-W(\d{2})$/.exec(week);
  return m ? `${Number(m[1])}. hét` : week;
};

const BUDAPEST = "Europe/Budapest";
export const idopont = (iso: string): string =>
  new Intl.DateTimeFormat("hu-HU", {
    timeZone: BUDAPEST,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export type KerdesAllapot =
  | { fajta: "nyitott"; kerdes: Kerdes; proba: boolean }
  /** nincs nyitott kérdés; a következő (ha van) előre látva, visszaszámlálóval */
  | { fajta: "nincs"; kovetkezo?: Kovetkezo | null }
  | { fajta: "elerhetetlen" };

/** Az ajándékdoboz: csak ott áll, ahol nincs nyeremény-kép (a nyeremény képe helyettesíti). */
function Ajandekdoboz() {
  return (
    <div className="jatek-gift-art" aria-hidden="true">
      <svg viewBox="0 0 180 160">
        <path d="M35 65h110v28H35zM43 93v55h94V93M90 65v83M32 65h116" />
        <path d="M90 65C34 64 51 14 75 35L90 65Zm0 0c56-1 39-51 15-30L90 65Z" />
      </svg>
      <span>?</span>
    </div>
  );
}

/** A nyeremény képe a lap saját útján (`/api/nyeremeny-kep/<kérdés>`), vagy az ajándékdoboz, ha nincs kép. */
function NyeremenyKep({
  kerdesId,
  nyeremeny,
}: {
  kerdesId: string;
  nyeremeny: Nyeremeny | null;
}) {
  return nyeremeny?.hasImage ? (
    <div className="jatek-prize-photo">
      <img
        src={`/api/nyeremeny-kep/${encodeURIComponent(kerdesId)}`}
        alt={nyeremeny.name}
        loading="lazy"
      />
    </div>
  ) : (
    <Ajandekdoboz />
  );
}

/**
 * A HETI KERDES SZAKASZ: a bal kartya a mostani kerdes es az urlap (vagy a "most nincs nyitott kerdes" /
 * "nem elerheto" mondat), a jobb kartya a heti ajandek helye a visszaszamlalo-val. A kerdes az api-bol jon
 * (`jatek-api.ts`), semmi nem szamolt vagy kitalalt: az "ajandek" szoveg a design szovege, amig nincs adat rola.
 */
export function HetiKerdesSzakasz({ allapot }: { allapot: KerdesAllapot }) {
  return (
    <section className="jatek-play-section jatek-wrap" id="heti-kerdes">
      <div className="jatek-section-heading">
        <div>
          <div className="jatek-eyebrow">A KÖVETKEZŐ MERÜLÉSED</div>
          <h2>Tiéd a következő válasz.</h2>
        </div>
        {allapot.fajta === "nyitott" ? (
          <span className="jatek-pill">{hetCimke(allapot.kerdes.week)}</span>
        ) : null}
      </div>
      <div className="jatek-game-grid">
        <article className="jatek-question-card">
          {allapot.fajta === "nyitott" ? (
            <>
              <div className="jatek-card-top">
                <span className="jatek-status">
                  <i />{" "}
                  {allapot.proba
                    ? "Kipróbálható mintakérdés"
                    : "Nyitott kérdés"}
                </span>
                <span>HETI KÉRDÉS</span>
              </div>
              <h3>{allapot.kerdes.prompt}</h3>
              <p className="jatek-muted">
                Beküldési határidő: {idopont(allapot.kerdes.closesAt)}
              </p>
              <BeadasUrlap kerdes={allapot.kerdes} />
            </>
          ) : allapot.fajta === "nincs" ? (
            <div className="jatek-nincs-kerdes">
              <h3>Most nincs nyitott kérdés.</h3>
              <p>
                A játékban hetente új kérdés nyílik. Nézz vissza később, vagy
                olvasd el addig a{" "}
                <a className="jatek-inline" href="/jatekszabalyzat">
                  játékszabályzatot
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="jatek-nincs-kerdes">
              <h3>A játék most nem érhető el.</h3>
              <p role="alert">{NEM_ELERHETO}</p>
            </div>
          )}
        </article>
        <aside className="jatek-week-card">
          {allapot.fajta === "nincs" && allapot.kovetkezo ? (
            <>
              <div className="jatek-eyebrow">A KÖVETKEZŐ NYEREMÉNY</div>
              <NyeremenyKep
                kerdesId={allapot.kovetkezo.id}
                nyeremeny={allapot.kovetkezo.prize}
              />
              <h3>
                {allapot.kovetkezo.prize?.name ?? "Következő kérdés hamarosan."}
              </h3>
              <p>
                {allapot.kovetkezo.prize
                  ? (allapot.kovetkezo.prize.description ??
                    "Következő kérdés hamarosan.")
                  : "A heti nyeremény a kérdéssel együtt jelenik meg."}
              </p>
              <div className="jatek-timer-block">
                <div className="jatek-timer-title">
                  <span>KÖVETKEZŐ KÉRDÉS HAMAROSAN</span>
                </div>
                <Visszaszamlalo
                  closesAt={allapot.kovetkezo.opensAt}
                  cimke="Visszaszámláló a következő kérdés megnyitásáig"
                />
                <small>Nyitás: {idopont(allapot.kovetkezo.opensAt)}</small>
              </div>
              <AutoFrissit celIdo={allapot.kovetkezo.opensAt} />
            </>
          ) : (
            <>
              <div className="jatek-eyebrow">EZEN A HÉTEN</div>
              <NyeremenyKep
                kerdesId={allapot.fajta === "nyitott" ? allapot.kerdes.id : ""}
                nyeremeny={
                  allapot.fajta === "nyitott" ? allapot.kerdes.prize : null
                }
              />
              {allapot.fajta === "nyitott" && allapot.kerdes.prize ? (
                <>
                  <h3>{allapot.kerdes.prize.name}</h3>
                  {allapot.kerdes.prize.description ? (
                    <p>{allapot.kerdes.prize.description}</p>
                  ) : null}
                </>
              ) : (
                <>
                  <h3>
                    A heti nyeremény
                    <br />
                    hamarosan kiderül.
                  </h3>
                  <p>A heti nyeremény az első kérdéssel együtt jelenik meg.</p>
                </>
              )}
              {allapot.fajta === "nyitott" ? (
                <div className="jatek-timer-block">
                  <div className="jatek-timer-title">
                    <span>VÁLASZADÁSI IDŐ</span>
                  </div>
                  <Visszaszamlalo closesAt={allapot.kerdes.closesAt} />
                  <small>
                    A kérdés zárása: {idopont(allapot.kerdes.closesAt)}
                  </small>
                  <AutoFrissit celIdo={allapot.kerdes.closesAt} />
                </div>
              ) : null}
            </>
          )}
          <div className="jatek-week-foot">
            Heti nyeremények. Egy különleges fődíj.
            <span>Az óceán rád vár.</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
