import { assetLabelCsv, type AssetLabelBatchSummary } from "@acropora/types";

/**
 * A KEPERNYO TISZTA RESZE: amit a lista MUTAT, es amit a letoltes AD.
 *
 * MIERT KULON FAJLBAN, ES NEM A KOMPONENSBEN. A komponens viselkedeset csak
 * rendereleessel lehet merni; ez itt allitasokkal merheto, es epp ez a ket
 * dolog az, amit el lehet rontani ugy, hogy a kepernyo tovabbra is "mukodik":
 * egy rossz idopont-alak es egy rossz fajlnev nem dob hibat.
 */

/**
 * A GENERALAS IDOPONTJA, PERCRE PONTOSAN.
 *
 * NEM SZEPSEGKERDES. Ket, egy percen belul inditott generalas csak igy
 * kulonboztetheto meg a listan -- es epp az a ket sor az, amibol egy veletlen
 * dupla kattintas latszik. Nap-pontossaggal a ket tetel egyformanak tunne, es
 * a felhasznalo azt hinne, hogy a rendszer duplikalta.
 */
export function batchTimestampLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ismeretlen időpont";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}. ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * A LETOLTOTT FAJL NEVE.
 *
 * A tetel azonositojanak eleje benne all: ha valaki ket ivet nyomtat egymas
 * utan, a ket fajl neve KULONBOZIK, es a letoltesek mappajaban nem irja felul
 * az egyik a masikat. Egy `matricak.csv` nevu masodik fajl a bongeszo szerint
 * `matricak (1).csv` lenne -- a papiron viszont mar nem latszik, melyik melyik.
 */
export function batchFileName(batchId: string, iso: string): string {
  const d = new Date(iso);
  const nap = Number.isNaN(d.getTime())
    ? "ismeretlen"
    : `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
  return `matricak-${nap}-${batchId.slice(0, 8)}.csv`;
}

/** A letoltendo tartalom. A formatum a kozos csomagbol jon, nem itt keletkezik. */
export function batchCsv(codes: readonly string[]): string {
  return assetLabelCsv(codes);
}

/**
 * A LISTA EGY SORA, EMBERI SZOVEGGEL.
 *
 * A SZABAD DARABSZAM MELLE ODAIRJUK, MIBOL. Egy puszta "3 szabad" azt is
 * jelenthetne, hogy harom van kinyomtatva -- a szam viszont a REGISZTRACIOBOL
 * jon, es a nyomtatas tenyet sehol nem rogzitjuk.
 */
export function batchSummaryLine(batch: AssetLabelBatchSummary): string {
  return `${batch.count} kód, ebből ${batch.freeCount} még nincs eszközhöz rendelve`;
}
