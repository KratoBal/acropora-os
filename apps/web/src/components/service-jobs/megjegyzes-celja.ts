import type { ServiceJobStatusValue } from "@acropora/types";

/**
 * A MEGJEGYZES AHHOZ A LEPESHEZ TARTOZIK, AMIHEZ IRTAK -- ES EDDIG SEMMI NEM
 * RÖGZITETTE, MELYIK VOLT AZ.
 *
 * === A NEMA UT, AMIT EZ LEZAR ===
 *
 * A jegy reszletlapjan EGYETLEN megjegyzes-mezo all, es alatta annyi gomb,
 * ahany lepes megengedett. A mezo egy sikertelen lepes utan SZANDEKOSAN
 * megtartja a szoveget (a `step()` fejlece kimondja, miert: egy elveszett
 * indokot ujra le kellene irni).
 *
 * A ket dontes kulon-kulon helyes, egyutt viszont egy csendes hibat adnak: ha
 * az "Alkatreszre var" lepes elbukik, a hozza irt mondat ottmarad, es ha a
 * kezelo ezutan a "Meghiusult" gombot nyomja meg, a MASIK atmenethez irt szoveg
 * megy fel -- hibauzenet nelkul.
 *
 * A jegynaplo onnantol egy olyan mondatot oriz, ami mashoz tartozik, es a sor
 * pontosan ugy nez ki, mint egy jo sor. Senki nem keresi.
 *
 * === MIERT MEGALLAS, ES NEM AUTOMATIKUS TORLES ===
 *
 * Kezenfekvo volna a szoveget egyszeruen eldobni a masik lepesnel. Az UGYANOLYAN
 * nema: a kezelo begepelt egy indokot, es az nyom nelkul eltunne.
 *
 * Ezert ez a szabaly NEM dont helyette, hanem MEGALL es megnevezi mind a ket
 * lepest. A szoveg megmarad, a dontes a kezeloe: atirja vagy torli.
 *
 * === AMIT EZ NEM OLD MEG, KIMONDVA ===
 *
 * Ha valaki FRISS szoveget ir, es elsore MAS gombot nyom meg, mint amire
 * gondolt, ez a szabaly nem szol -- nincs mihez merni, a szoveg nem tartozik
 * meg semmihez. Azt csak egy megerosito lepes fogna meg, az viszont MINDEN
 * megjegyzeses atmenetre surlodast tenne. Ez termek-dontes, nem javitas, es
 * kulon all.
 */
export interface MegjegyzesCelja {
  /** A lepes, amihez a mezoben allo szoveg keszult. `null`, ha friss a mezo. */
  lepes: ServiceJobStatusValue | null;
}

export type MegjegyzesEllenorzes =
  { rendben: true } | { rendben: false; uzenet: string };

/**
 * SZABAD-E EZT A SZOVEGET EHHEZ A LEPESHEZ KULDENI.
 *
 * A `cimke` a hivo dolga: a felirat-tabla a komponensben all, es ez a modul
 * szandekosan nem importalja -- igy a szabaly adatbazis es felulet nelkul
 * merheto.
 */
export function megjegyzesKuldheto(input: {
  szoveg: string;
  celzott: ServiceJobStatusValue | null;
  most: ServiceJobStatusValue;
  cimke: (lepes: ServiceJobStatusValue) => string;
}): MegjegyzesEllenorzes {
  // URES MEZO SOHA NEM AKADALY. Ha nincs szoveg, nincs mit rossz helyre vinni,
  // es a megjegyzes amugy is elhagyhato minden atmenetnel.
  if (input.szoveg.trim() === "") return { rendben: true };

  // FRISS SZOVEG: nem tartozik meg semmihez, tehat nincs mihez merni.
  if (input.celzott === null) return { rendben: true };

  if (input.celzott === input.most) return { rendben: true };

  return {
    rendben: false,
    uzenet:
      `Ez a megjegyzés a(z) „${input.cimke(input.celzott)}" lépéshez készült, ` +
      `most pedig a(z) „${input.cimke(input.most)}" lépést választottad. ` +
      "Írd át vagy töröld a megjegyzést, és próbáld újra.",
  };
}
