/**
 * A FOOLDAL ALLANDO SZAKASZAI (Luca designja, 2026-11-05): hero a fodij-kartyaval, a kampany-sav, a harom lepes, a
 * nyertesek helye, a gyakori kerdesek. Nincs bennuk adat az api-bol: a szoveg a design szovege, ELTERESEKKEL, amiket
 * a valos jatek kovetel (Balazs: nincs hirlevel-jelolo; a valos folyamat: megerosito level; nincs "prototipus"):
 * a szovegek, amelyek a prototipus tulajdonsagat irtak le, a jatek tenyleges mukodeset mondjak.
 *
 * A TERMEKFOTO (`/nano.jpg`) az Aquaforest hivatalos fotoja (a designcsomagbol; forras: aquaforest.eu). A felhasznalasi
 * engedelyt NEM tudom: a kerdes a tulajdonosnak szol (lasd a PR-torzset).
 */
export function Hero() {
  return (
    <section className="jatek-hero jatek-wrap" id="fodij">
      <div className="jatek-hero-copy">
        <div className="jatek-eyebrow">
          <span className="jatek-line" /> ACROPORA NYEREMÉNYJÁTÉK · 2026
        </div>
        <h1>
          Egy kérdés.
          <br />
          Egy lépéssel
          <br />
          <em>
            közelebb az
            <br />
            óceánhoz.
          </em>
        </h1>
        <p>
          Játssz velünk hétről hétre, nyerj heti nyereményeket,
          <br className="jatek-desktop" /> és álmodj egy saját tengeri világot.
        </p>
        <div className="jatek-hero-actions">
          <a className="jatek-button" href="#heti-kerdes">
            Merülj játékba <span>↗</span>
          </a>
          <a className="jatek-text-link" href="#hogyan">
            Hogyan működik? <span>↓</span>
          </a>
        </div>
        <div className="jatek-launch">
          <span className="jatek-play">▶</span>
          <div>
            <strong>Indulás: november 7., szombat</strong>
            <small>
              Az Acropora YouTube élő adásában · 2026. november 7. 21:00 óra
            </small>
          </div>
        </div>
      </div>
      <div className="jatek-hero-art">
        <div className="jatek-orbit" />
        <img
          src="/nano.jpg"
          alt="Aquaforest AF Nano Tank tengeri akvárium színes korallokkal, hivatalos termékfotó"
        />
        <div className="jatek-prize-label">
          <span className="jatek-eyebrow">A KAMPÁNY FŐDÍJA</span>
          <h2>AF Nano Tank</h2>
          <span>AQUAFOREST</span>
          <a href="/fodij">Ismerd meg az akváriumot ↗</a>
        </div>
        <span className="jatek-photo-note">
          Gyártói illusztráció · a dekoráció és az élővilág nem része a
          nyereménynek
        </span>
      </div>
    </section>
  );
}

export function KampanySav() {
  return (
    <div className="jatek-campaign-strip jatek-wrap">
      <span>
        <b>01</b> Hetente egy új kérdés
      </span>
      <span>
        <b>07</b> nap a válaszadásra
      </span>
      <span>
        <b>∞</b> Óceánnyi élmény
      </span>
      <span className="jatek-strip-end">KIS AKVÁRIUM. NAGY ÁLMOK.</span>
    </div>
  );
}

export function Lepesek() {
  return (
    <section className="jatek-how jatek-wrap" id="hogyan">
      <div className="jatek-eyebrow">EGYSZERŰEN BELEVÁGHATSZ</div>
      <h2>Három lépés. És már játékban is vagy.</h2>
      <div className="jatek-steps">
        <article>
          <span>
            01 <i>↗</i>
          </span>
          <h3>Nézd meg a heti kérdést</h3>
          <p>
            Minden héten új kérdés vár itt, a weboldalon. Az indulást az
            Acropora YouTube élő adásában követheted.
          </p>
        </article>
        <article>
          <span>
            02 <i>↗</i>
          </span>
          <h3>Küldd be a válaszod</h3>
          <p>
            Egy heted van válaszolni. Add meg az e-mail-címedet, fogadd el a
            játékszabályzatot, és erősítsd meg a részvételed a levélben kapott
            linkkel.
          </p>
        </article>
        <article>
          <span>
            03 <i>✳</i>
          </span>
          <h3>Várd a heti sorsolást</h3>
          <p>
            A válaszadási időszak után heti nyereményt sorsolunk a helyes
            válaszok között. A kampány fődíja az Aquaforest AF Nano Tank.
          </p>
        </article>
      </div>
    </section>
  );
}

export function Nyertesek() {
  return (
    <section className="jatek-winners jatek-wrap" id="nyertesek">
      <div className="jatek-section-heading">
        <div>
          <div className="jatek-eyebrow">AKIKNEK KEDVEZETT A SZERENCSE</div>
          <h2>Az eddigi sorsolások nyertesei.</h2>
        </div>
        <span className="jatek-pill">Még a rajt előtt vagyunk</span>
      </div>
      <div className="jatek-empty-winners">
        <span className="jatek-trophy">♧</span>
        <div>
          <h3>Az első nyertes helye már megvan.</h3>
          <p>
            Az első sorsolás után itt találod a korábbi nyerteseket és a heti
            nyereményeket. Jelenleg nincs kihirdetett eredmény.
          </p>
        </div>
        <span className="jatek-empty-number">01</span>
      </div>
    </section>
  );
}

const KERDESEK: readonly { kerdes: string; valasz: string }[] = [
  {
    kerdes: "Mikor indul a nyereményjáték?",
    valasz:
      "2026. november 7-én, szombaton, az Acropora YouTube élő adásában, 21:00 órakor.",
  },
  {
    kerdes: "Meddig válaszolhatok egy kérdésre?",
    valasz:
      "Egy hétig. A forduló pontos határideje mindig az aktuális kérdés mellett jelenik meg.",
  },
  {
    kerdes: "Hányszor játszhatok?",
    valasz:
      "Egy e-mail-címmel hetente egyszer. A sorsolásba csak a helyes, megerősített válaszok kerülnek; aki több héten játszik helyesen, többször szerepel a karácsonyi sorsolás jelöltlistáján.",
  },
  {
    kerdes: "Mire használjátok az e-mail-címemet?",
    valasz:
      "Csak a játékra és a nyertes értesítésére. Hírlevélre nem iratkozol fel, és a részvételnek nem feltétele semmilyen feliratkozás.",
  },
  {
    kerdes: "Honnan tudom meg, hogy nyertem?",
    valasz:
      "A heti sorsolások a játék indulása után minden szombaton este 9 órakor történnek. A kisorsolt nyertes neve megjelenik itt az oldalon, de e-mailben is felvesszük Veled a kapcsolatot.",
  },
];

export function Gyik() {
  return (
    <section className="jatek-faq jatek-wrap">
      <div>
        <div className="jatek-eyebrow">JÓ TUDNI</div>
        <h2>Mielőtt elmerülsz.</h2>
      </div>
      <div>
        {KERDESEK.map((k) => (
          <details key={k.kerdes}>
            <summary>{k.kerdes}</summary>
            <p>{k.valasz}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
