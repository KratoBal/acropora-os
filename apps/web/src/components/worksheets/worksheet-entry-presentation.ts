/**
 * KI ES MIKOR IRTA A BEJEGYZEST -- EGY SORBAN.
 *
 * KULON, TISZTA MODUL, mert ket kepernyo hasznalja (a lista es a bejegyzes
 * sajat lapja), es mert igy MERHETO komponens-render nelkul is.
 *
 * === AZ ISMERETLEN SZERZO KIMONDVA, NEM ELREJTVE ===
 *
 * A szerzo azonositoja a szerveren `SetNull` a felhasznalo torlesekor: a
 * bejegyzes megmarad, a nev nelkul. Egy ures hely a nev helyen betoltesi
 * hibanak latszik; egy kihagyott sor pedig azt allitana, hogy a bejegyzes nem
 * is letezik.
 *
 * === ES HA ATIRTAK, AZ IS LATSZIK ===
 *
 * A `updatedAt` a keletkezessel EGYENLO, amig senki nem nyult hozza. Ha
 * kesobbi, azt ki kell mondani: egy szerkesztett bejegyzes ugyanugy nez ki,
 * mint az eredeti, es aki a lapot olvassa, nem tudja megkulonboztetni.
 */

export interface WorksheetEntryLike {
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

function magyarDatum(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function worksheetEntryByline(entry: WorksheetEntryLike): string {
  const ki = entry.authorName ?? "Ismeretlen szerző";
  const atirva =
    entry.updatedAt !== entry.createdAt
      ? `, szerkesztve ${magyarDatum(entry.updatedAt)}`
      : "";
  return `${ki} · ${magyarDatum(entry.createdAt)}${atirva}`;
}
