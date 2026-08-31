/**
 * A CIMKE-KEP GEOMETRIAJA, KEPPONTBAN.
 *
 * Miert kell egyaltalan: a nyomtato alkalmazasa a megosztas laprol NEM vesz at
 * fajlt (a sajat hibauzenete mondja ki, 2026-08-26), viszont egy BEIMPORTALT
 * kepet elfogad es kinyomtat. A cimke tehat kepkent kell hogy elkeszuljon.
 *
 * ES AMIERT EZ A MODUL NEM RAJZOL, CSAK SZAMOL: a beolvashatosag EGYETLEN
 * szamon mulik, a QR-modul meretén, es azt a rajzolas elott el kell donteni.
 * Egy rajzolo, ami menet kozben kerekit, pontosan azt a hibat termeli ujra,
 * ami a ket oldalas PDF-et okozta -- csak most a kodon belul.
 *
 * A SZABALY, AMI MINDENT ELDONT: egy QR-modul EGESZ SZAMU keppont legyen, es a
 * kod EGESZ keppont-hataron alljon. Ha egy modul tortszamu keppont, a
 * raszterizalas nemelyik modulnak eggyel tobbet ad, mint a masiknak. A kod
 * ettol nem "kicsit rosszabb" lesz, hanem EGYENETLEN, es a beolvasas ezen bukik.
 *
 * EZERT NEM DPI-BOL INDULUNK. A szokasos ertekek egyike sem ad egesz modult a
 * mi cimkenkre: 203 dpi -> 3,68 keppont modulonkent; 300 -> 5,44; 360 -> 6,53;
 * 600 -> 10,88. A modulbol indulunk, es a dpi az EREDMENY, nem a bemenet.
 */

export type LabelImageInput = {
  /** A lap hossza milliméterben (a szalag iranyaban). */
  pageWidthMm: number;
  /** A lap magassaga milliméterben (a szalag keresztiranyaban). */
  pageHeightMm: number;
  /** Belso margo minden oldalon, milliméterben. */
  paddingMm: number;
  /** Res a kod es a feliratsav kozott, milliméterben. */
  gapMm: number;
  /** A QR rajz szelessege MODULBAN, a csendes zonaval egyutt. */
  qrModules: number;
  /** Hany keppont legyen EGY modul. Ez a bemenet, nem a dpi. */
  pixelsPerModule: number;
};

export type LabelImageGeometry = {
  /** A vaszon szelessege keppontban. */
  widthPx: number;
  /** A vaszon magassaga keppontban. */
  heightPx: number;
  /** A QR oldalhossza keppontban. Mindig oszthato a modulszammal. */
  qrSizePx: number;
  /** A QR bal felso sarka, egesz keppontokban. */
  qrXPx: number;
  qrYPx: number;
  /** A feliratsav bal széle es szelessege, egesz keppontokban. */
  textXPx: number;
  textWidthPx: number;
  /** Amit a kep magarol allit: hany keppont egy milliméter. */
  pixelsPerMm: number;
  /** A tenyleges felbontas, tajekoztatasul. NEM bemenet volt. */
  effectiveDpi: number;
};

export class LabelImageGeometryError extends Error {}

/**
 * A LEVEZETES.
 *
 * A KIINDULOPONT A QR, nem a lap: eloszor eldontjuk, hany keppont egy modul,
 * ebbol jon a kod merete, es a lap tobbi resze EHHEZ igazodik. Forditva
 * (lapmeretbol) a modul tortszam lenne, es az az egyetlen szam, amit nem
 * szabad elrontani.
 */
export function labelImageGeometry(input: LabelImageInput): LabelImageGeometry {
  assertPositiveInteger(input.qrModules, "qrModules");
  assertPositiveInteger(input.pixelsPerModule, "pixelsPerModule");

  const qrHeightMm = input.pageHeightMm - 2 * input.paddingMm;
  if (qrHeightMm <= 0)
    throw new LabelImageGeometryError(
      "A belso margo nem hagy helyet a kodnak: a lap magassaga kisebb, mint a ket margo.",
    );

  const qrSizePx = input.qrModules * input.pixelsPerModule;
  const pixelsPerMm = qrSizePx / qrHeightMm;

  /**
   * A VASZON FELFELE KEREKEDIK, sosem lefele. Egy lefele kerekites levagna a
   * kod szelet vagy a feliratot; a felfelé kerekites legrosszabb esetben egy
   * keppontnyi ures savot hagy, ami nem ront el semmit.
   */
  const widthPx = Math.ceil(input.pageWidthMm * pixelsPerMm);
  const heightPx = Math.ceil(input.pageHeightMm * pixelsPerMm);

  const paddingPx = Math.round(input.paddingMm * pixelsPerMm);
  const gapPx = Math.round(input.gapMm * pixelsPerMm);

  /**
   * A KOD EGESZ KEPPONT-HATARON ALL. A fuggoleges kozepre igazitast SZANDEKOSAN
   * kerekitjuk: fel keppontnyi eltolas ugyanugy szetkeni a modulhatarokat,
   * mintha a modul nem lenne egesz. A meret es az elhelyezes egyutt dont.
   */
  const qrXPx = paddingPx;
  const qrYPx = Math.round((heightPx - qrSizePx) / 2);

  const textXPx = qrXPx + qrSizePx + gapPx;
  const textWidthPx = widthPx - paddingPx - textXPx;
  if (textWidthPx <= 0)
    throw new LabelImageGeometryError(
      "A feliratnak nem marad helye: a kod es a margok kitoltik a lap hosszat.",
    );

  return {
    widthPx,
    heightPx,
    qrSizePx,
    qrXPx,
    qrYPx,
    textXPx,
    textWidthPx,
    pixelsPerMm,
    effectiveDpi: pixelsPerMm * 25.4,
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new LabelImageGeometryError(
      `A(z) "${name}" ertekenek pozitiv egesz szamnak kell lennie, kapott: ${value}.`,
    );
}
