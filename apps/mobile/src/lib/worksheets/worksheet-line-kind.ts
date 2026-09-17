/**
 * A MUNKALAP-TETEL FAJTAJA, KULON MODULBAN -- ES EZ NEM TAGOLASI IZLES.
 *
 * === MIERT NEM A `lib/api/worksheets.ts`-BEN ALL ===
 *
 * A teszt-forditas sajat beallitassal megy (`tsconfig.test.json`), es abban
 * SZANDEKOSAN nincs `paths`, tehat a `@/` alias nem oldodik fel. Az API-modul
 * viszont `@/config/env` es `@/lib/auth/token-store` alakokat importal.
 *
 * Merve 2026-09-17: amint a `worksheet-line.ts` egy TIPUST importalt onnan, a
 * teljes modul-graf bekerult a teszt-forditasba, es HAROM `TS2307` hibaval allt
 * meg -- vagyis NULLA teszt futott le. A `kalibracio.sh` ezt kimondta ("NULLA
 * TESZT FUTOTT LE"); egy csupasz `grep`-es olvasas tiszta futasnak latta volna.
 *
 * A tipus-import sem elég: a fordito akkor is FELOLDJA a modult, hogy a tipust
 * megtalalja benne.
 *
 * === A SZABALY, AMI EBBOL KOVETKEZIK ===
 *
 * Amit a teszt-forditas ala eso modul (`lib/worksheets/*`, `lib/offline/*`)
 * hasznal, az ne az API-retegbol jojjon -- meg tipuskent sem. Az ilyen kozos
 * alak ide, egy fuggoseg nelkuli modulba valo, es az API-reteg IS innen
 * importalja: igy a ket oldal nem csuszhat el egymastol.
 */
export type WorksheetLineKind = "LABOR" | "OTHER";
