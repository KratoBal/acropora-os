import { FodijVilagitas } from "./fodij-vilagitas.tsx";

/**
 * AZ AF NANO TANK BEMUTATO OLDALA (a fodij), magyarul. Az eredeti Aquaforest-oldal szakaszrendje es elrendezese, a
 * jatek sajat stilusaban (szinek, betuk); a lablec, a hirlevel, a menu es a sutisav kimarad (Balazs kerese,
 * 2026-11-06). A szoveg a `exchange/jatek/aquaforest-nano-tank/szoveg-hu.md` forditasa, szakaszonkent. A kepek
 * `/fodij/...` alatt allnak (a design-csomag feldolgozott kepei); az eredeti oldalon nincs alt szoveg, ezeket mi irtuk.
 *
 * JOG: az Aquaforest-tol szarmazo szoveg, kep es video atvetele. Az engedelyt Balazs tisztazza, ELES telepites elott
 * kell (acrobot, 2026-11-06).
 */
const IKONOK = [
  { src: "ikon-szuro.svg", szoveg: "REJTETT SZŰRÉS" },
  { src: "ikon-vilagitas.svg", szoveg: "KORALLOS LED-VILÁGÍTÁS" },
  { src: "ikon-szivattyu.svg", szoveg: "KERINGETŐ SZIVATTYÚ" },
  { src: "ikon-futo.svg", szoveg: "VÍZMELEGÍTŐ" },
];

const TERMEKEK = [
  {
    src: "termek-reef-salt.png",
    nev: "REEF SALT",
    alt: "Reef Salt tengeri só zacskója",
  },
  {
    src: "termek-nano-rock.png",
    nev: "NANO ROCK",
    alt: "Nano Rock dekorkő doboza",
  },
  {
    src: "termek-bio-sand.png",
    nev: "AF BIO SAND",
    alt: "AF Bio Sand akváriumhomok zacskója",
  },
  {
    src: "termek-life-bio-fil.png",
    nev: "LIFE BIO FIL",
    alt: "Life Bio Fil baktériumkészítmény doboza",
  },
  {
    src: "termek-life-source.png",
    nev: "LIFE SOURCE",
    alt: "Life Source készítmény zacskója",
  },
  { src: "termek-bio-s.png", nev: "BIO S", alt: "BioS cseppek dobozban" },
];

const LEPESEK = [
  {
    kep: "lepes-1.webp",
    szoveg: "Csomagold ki az akváriumodat",
    alt: "Rajz: a kicsomagolt akváriumdoboz",
  },
  {
    kep: "lepes-2.webp",
    szoveg: "Szórd be a homokot",
    alt: "Rajz: homok szórása az akváriumba",
  },
  {
    kep: "lepes-3.webp",
    szoveg: "Építsd fel a víz alatti tájat",
    alt: "Rajz: a dekorkő felrakása az akváriumba",
  },
  {
    kep: "lepes-4.webp",
    szoveg: "Töltsd fel sós vízzel",
    alt: "Rajz: sós víz töltése az akváriumba",
  },
  {
    kep: "lepes-5.webp",
    szoveg: "Indítsd el a rendszert",
    alt: "Rajz: az akvárium rendszerének bekapcsolása",
  },
  {
    kep: "lepes-6.webp",
    szoveg: "Add hozzá a hasznos baktériumokat",
    alt: "Rajz: baktériumkészítmény adagolása a vízbe",
  },
];

const MIERT = [
  {
    kep: "miert-szures.webp",
    cim: "Rejtett szűrés",
    szoveg: "Letisztult megjelenés, látható technika nélkül.",
    alt: "Az akvárium fekete oldalfala, mögötte a rejtett szűrőház",
  },
  {
    kep: "miert-egyutt.webp",
    cim: "Együttműködésre tervezve",
    szoveg:
      "Minden elemet teljes rendszerként válogattunk össze és teszteltünk.",
    alt: "A szűrőház kamrái és a csatlakozó cső közelről",
  },
  {
    kep: "miert-kezdo.webp",
    cim: "Kezdőknek is könnyű",
    szoveg: "Egyszerű összeállítás, még ha ez az első tengeri akváriumod is.",
    alt: "Az akvárium üvegtartálya és a ráhelyezett LED-lámpa",
  },
  {
    kep: "miert-kompakt.webp",
    cim: "Kompakt, mégis lenyűgöző",
    szoveg: "Ideális méret otthonra, irodába és lakásba.",
    alt: "Az üres, kocka alakú akvárium a fekete szekrényén",
  },
];

const KINEK = [
  {
    kep: "kinek-kezdo.webp",
    cim: "Első korallos akváriumnak",
    szoveg: "Könnyű belépő a tengeri akváriumok világába.",
    alt: "Az akvárium korallokkal, ibolya fényben",
  },
  {
    kep: "kinek-csalad.webp",
    cim: "Családoknak és gyerekeknek",
    szoveg: "Fedezzétek fel együtt a víz alatti világot.",
    alt: "Egy mosolygó kislány az akvárium üvegénél, mögötte bohóchal és korallok",
  },
  {
    kep: "kinek-nano.webp",
    cim: "Nano akvárium rajongóknak",
    szoveg: "Kompakt kiegészítés bármelyik gyűjteményhez.",
    alt: "Egy férfi a színes korallokkal teli akvárium mögött",
  },
  {
    kep: "kinek-nyugalom.webp",
    cim: "Kikapcsolódáshoz és jó közérzethez",
    szoveg: "Hozz el egy darabot az óceánból a mindennapjaidba.",
    alt: "Az akvárium kék fényben egy pihenősarokban",
  },
];

const AKVARIUM = [
  ["Medence mérete", "45 × 45 × 45 cm"],
  ["Űrtartalom", "90 L bruttó / 85 L nettó"],
  ["Üveg", "6 mm Super White"],
  ["Szűrőház", "3 kamra, állítható vízbeszívással"],
  ["Szivattyú", "1000 L/h DC keringető szivattyú"],
  ["Fűtő", "150 W üveg fűtő"],
  ["LED-lámpa", "90 LED, 18 W"],
];

const CSOMAG = [
  ["Reef Salt", "2 × 2 kg"],
  ["Nano Rock", "3,5 kg"],
  ["Bio Sand", "10 kg"],
  ["Afix Glue", "13 g"],
  ["BioS", "10 ml"],
  ["Life Bio Fil", "250 ml"],
  ["Life Source", "250 ml"],
];

const kep = (fajl: string) => `/fodij/${fajl}`;

function Tabla({ cim, sorok }: { cim: string; sorok: string[][] }) {
  return (
    <div className="fodij-tabla">
      <h3>{cim}</h3>
      <dl>
        {sorok.map(([nev, ertek]) => (
          <div key={nev}>
            <dt>{nev}</dt>
            <dd>{ertek}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FodijOldal() {
  return (
    <div className="fodij">
      <section className="fodij-hero jatek-wrap">
        <div className="fodij-hero-szoveg">
          <p className="fodij-cimke">ÚJ</p>
          <h1>TENGER A DOBOZBAN</h1>
          <h2>TELJES, KÉSZ, TÖKÉLETES</h2>
          <p>
            Tengeri akváriumot indítani még sosem volt ilyen egyszerű.{" "}
            <strong>
              Az AF Nano Tank mindent tartalmaz, ami az első sósvízi akváriumod
              felépítéséhez kell
            </strong>
            : gondosan válogatott technikát, tengersót, dekorkövet, homokot és a
            nélkülözhetetlen indító baktériumokat.
          </p>
          <a className="jatek-button" href="#keszlet">
            ISMERD MEG A KÉSZLETET <span>↗</span>
          </a>
        </div>
        <div className="fodij-hero-kep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/nano.jpg"
            alt="Az AF Nano Tank tengeri akvárium színes korallokkal és LED-lámpával."
          />
        </div>
      </section>

      <section
        className="fodij-video jatek-wrap"
        aria-labelledby="fodij-video-cim"
      >
        <h2 id="fodij-video-cim">A SAJÁT ABLAKOD AZ ÓCEÁNRA</h2>
        <video
          controls
          muted
          loop
          playsInline
          preload="none"
          poster={kep("video-poszter.jpg")}
          aria-label="Bemutató videó: az AF Nano Tank koralljai közelről"
        >
          <source src={kep("video.mp4")} type="video/mp4" />
        </video>
        <p className="fodij-meret">
          <span>45 CM / 17,7″</span>
        </p>
      </section>

      <section
        id="keszlet"
        className="fodij-csomag"
        aria-labelledby="fodij-csomag-cim"
      >
        <div className="jatek-wrap">
          <h2 id="fodij-csomag-cim">
            <em>MINDEN, AMI KELL,</em> EGY CSOMAGBAN
          </h2>
          <p className="fodij-alcim">Minden benne van. Semmi sem hiányzik.</p>
          <ul className="fodij-ikonok">
            {IKONOK.map((i) => (
              <li key={i.src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={kep(i.src)} alt="" aria-hidden="true" />
                <span>{i.szoveg}</span>
              </li>
            ))}
          </ul>
          <p className="fodij-elvalaszto">
            <span>SZINTÉN A CSOMAG RÉSZE</span>
          </p>
          <ul className="fodij-termekek">
            {TERMEKEK.map((t) => (
              <li key={t.src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={kep(t.src)}
                  alt={t.alt}
                  loading="lazy"
                  decoding="async"
                />
                <span>{t.nev}</span>
              </li>
            ))}
          </ul>
          <p className="fodij-zaromondat">
            Nincs találgatás. Nem kell egymáshoz illő technikát keresgélned.
            <br />
            <strong>
              Minden elemet úgy választottunk ki, hogy az első naptól együtt
              működjön.
            </strong>
          </p>
        </div>
      </section>

      <section
        className="fodij-lepesek jatek-wrap"
        aria-labelledby="fodij-lepesek-cim"
      >
        <h2 id="fodij-lepesek-cim">
          A DOBOZTÓL A SZIRTIG, NÉHÁNY EGYSZERŰ LÉPÉSBEN
        </h2>
        <ol>
          {LEPESEK.map((l) => (
            <li key={l.kep}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kep(l.kep)}
                alt={l.alt}
                loading="lazy"
                decoding="async"
              />
              <span>{l.szoveg}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="fodij-miert" aria-labelledby="fodij-miert-cim">
        <div className="jatek-wrap">
          <h2 id="fodij-miert-cim">MIÉRT AZ AF NANO TANK?</h2>
        </div>
        <div className="fodij-csempek">
          {MIERT.map((m) => (
            <article key={m.kep}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kep(m.kep)}
                alt={m.alt}
                loading="lazy"
                decoding="async"
              />
              <div>
                <h3>{m.cim}</h3>
                <p>{m.szoveg}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="fodij-vilagitas-szakasz jatek-wrap"
        aria-labelledby="fodij-vilagitas-cim"
      >
        <h2 id="fodij-vilagitas-cim">
          VILÁGÍTÁS, AMI TÖKÉLETES HANGULATOT TEREMT
        </h2>
        <FodijVilagitas />
      </section>

      <section className="fodij-kinek" aria-labelledby="fodij-kinek-cim">
        <div className="jatek-wrap">
          <h2 id="fodij-kinek-cim">TÖKÉLETES VÁLASZTÁS</h2>
        </div>
        <div className="fodij-panelek">
          {KINEK.map((k) => (
            <article key={k.kep}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kep(k.kep)}
                alt={k.alt}
                loading="lazy"
                decoding="async"
              />
              <div>
                <h3>{k.cim}</h3>
                <p>{k.szoveg}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        className="fodij-doboz jatek-wrap"
        aria-labelledby="fodij-doboz-cim"
      >
        <h2 id="fodij-doboz-cim">MI VAN A DOBOZBAN?</h2>
        <div className="fodij-tablak">
          <Tabla cim="AKVÁRIUM" sorok={AKVARIUM} />
          <Tabla cim="A CSOMAGBAN LÉVŐ AQUAFOREST TERMÉKEK" sorok={CSOMAG} />
        </div>
      </section>

      <section className="fodij-zaro" aria-labelledby="fodij-zaro-cim">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={kep("zaro.webp")}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
        <div className="fodij-zaro-szoveg">
          <h2 id="fodij-zaro-cim">KOCKA ALAKÚ KAPU A TISZTA NYUGALOMHOZ</h2>
          <p>
            Hozz létre virágzó tengeri ökoszisztémát egy teljes készlettel,
            amelyet úgy terveztünk, hogy az első naptól egyszerű, szép és
            sikeres legyen.
          </p>
          <a className="jatek-button" href="/#heti-kerdes">
            KEZDD EL MA A SÓSVÍZI UTAZÁSODAT <span>↗</span>
          </a>
        </div>
      </section>
    </div>
  );
}
