/**
 * EGY BOLTI KEP-CIM BESOROLASA: KIVULROL ELERHETO-E.
 *
 * === MIERT LETEZIK ===
 *
 * A bolt `file-local` szolgaltatoja MINDEN nyilvanos kep-cimet egyetlen
 * ertekbol epit (`backend_url`), es ha az nincs beallitva, a sajat tartaleka
 * lep be: `http://localhost:9000/static`. Az a cim a kiszolgalon feloldodik, es
 * SEHOL MASHOL -- a vevo tort kepet lat, a mi kepernyoink viszont rendben
 * mutatnak mindent. A hiba nem hasal el es nem naploz.
 *
 * A cim a feltolteskor a MI oldalunkra is beirodik (`ExternalReference`,
 * `externalKey`), es ott is marad: a vetites minden futasban ezt a tarolt
 * erteket adja tovabb a boltnak, tehat egy rossz cim nem gyogyul meg attol,
 * hogy a beallitas kesobb helyre kerul.
 *
 * === MIT ALLIT, ES MIT NEM ===
 *
 * Ez a fuggveny a cim ALAKJAROL mond velemenyt, NEM arrol, hogy a kep ma
 * betoltodik-e. Egy `public` besorolasu cim is lehet halott (torolt fajl, mas
 * hoszt), es azt csak egy lehivas mondana meg. Amit allit, az szukebb es
 * biztosabb: egy `internal` cim a nyilt halozatrol NEM erheto el, barmi is
 * legyen a fajl mogotte.
 *
 * A besorolas ezert nem "hibas kontra jo", hanem "kivulrol elerhetetlen kontra
 * a tobbi". A ket szo nem ugyanaz, es a kulonbseget a hivonak is ki kell
 * irnia, kulonben a szam ugy utazik tovabb, hogy tobbet allit, mint amit
 * mertunk.
 */

/** A cim harom lehetseges besorolasa. Nincs negyedik: a `public` a maradek. */
export type ImageAddressKind = "public" | "internal" | "unreadable";

export interface ImageAddressVerdict {
  kind: ImageAddressKind;
  /**
   * A CSOPORTOSITAS KULCSA: `scheme://host[:port]`, ut nelkul.
   *
   * Azert kell a szam melle, mert egy puszta darabszam elrejti a HALMAZT. Ha
   * minden sor ugyanarra a hosztra mutat, az mast jelent, mint ha haromra --
   * es a besorolo szabalyom lehet szukebb a valosagnal. A hoszt-bontas az a
   * kontroll, ami ezt megmutatja anelkul, hogy a szabalyt kellene hinni.
   *
   * Olvashatatlan cimnel `"(olvashatatlan)"`, mert oda nincs mit csoportositani.
   */
  origin: string;
}

export const UNREADABLE_ORIGIN = "(olvashatatlan)";

/** Csak a szamjegyekbol es pontokbol allo hoszt lehet IPv4. */
function ipv4Oktettek(host: string): number[] | null {
  const reszek = host.split(".");
  if (reszek.length !== 4) return null;
  const szamok = reszek.map((r) => (/^\d{1,3}$/.test(r) ? Number(r) : -1));
  return szamok.every((n) => n >= 0 && n <= 255) ? szamok : null;
}

/**
 * KIVULROL ELERHETETLEN-E EZ A HOSZT.
 *
 * A lista NEM tetszoleges: mindegyik sor olyan nevet vagy tartomanyt fog meg,
 * amit egy kiszolgalo fel tud oldani, egy vevo bongeszoje viszont nem.
 */
export function internalHost(host: string): boolean {
  const h = host.toLowerCase();

  // A szolgaltato mert tartaleka, es a szokasos rokonai.
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6 hurok es a "barmelyik cim" alak; a URL a szogletes zarojelet megtartja.
  if (h === "[::1]" || h === "[::]" || h === "0.0.0.0") return true;

  const oktett = ipv4Oktettek(h);
  if (oktett) {
    const [a, b] = oktett as [number, number, number, number];
    if (a === 127) return true; // hurok
    if (a === 10) return true; // maganhalozat
    if (a === 192 && b === 168) return true; // maganhalozat
    if (a === 172 && b >= 16 && b <= 31) return true; // maganhalozat
    if (a === 169 && b === 254) return true; // kapcsolat-helyi
    return false;
  }

  // Konteneren belul osztott nevek.
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;

  /**
   * EGY CIMKEBOL ALLO NEV: a `docker compose` szolgaltatas-neve (`medusa`,
   * `backend`). Nyilvanos tartomanyban mindig van pont, tehat a pont hianya
   * onmagaban elarulja, hogy a nev csak a halozaton belul jelent valamit.
   */
  return !h.includes(".");
}

export function classifyImageAddress(url: string): ImageAddressVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unreadable", origin: UNREADABLE_ORIGIN };
  }

  /**
   * Hoszt nelkuli sema (`data:`, `file:`) ide esik: nem cim, amit egy vevo
   * bongeszoje le tudna kerni, de nem is belso hoszt -- kulon kell latszania.
   */
  if (!parsed.hostname)
    return { kind: "unreadable", origin: UNREADABLE_ORIGIN };

  const origin = `${parsed.protocol}//${parsed.host}`;
  return {
    kind: internalHost(parsed.hostname) ? "internal" : "public",
    origin,
  };
}
