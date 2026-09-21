import type {
  ServiceJobPartnerStatus,
  ServiceJobStatusValue,
} from "@acropora/types";

import type { ServiceTone } from "@/components/service/service-theme";

/**
 * A NYOLC BELSŐ ÁLLAPOT MAGYARUL.
 *
 * A NÉGY LÁTSZÓ ÁLLAPOT SZÖVEGÉT A SZERVER ADJA (`partnerStatusLabel`), és
 * szándékosan nem másoljuk ide: az a partner nyelve, egy helyen áll, és ha itt
 * is állna, egyszer elcsúszna - onnantól a partner mást olvasna, mint amit mi
 * hiszünk róla. Ez a táblázat CSAK a belső nyolcé, amit a partner nem lát.
 */
export const serviceJobStatusLabel: Record<ServiceJobStatusValue, string> = {
  NEW: "Új",
  TRIAGED: "Felmérve",
  SCHEDULED: "Ütemezve",
  IN_PROGRESS: "Folyamatban",
  WAITING_FOR_PARTS: "Alkatrészre vár",
  WAITING_FOR_CUSTOMER: "Ügyfélre vár",
  COMPLETED: "Elkészült",
  /**
   * BALAZS DONTESE, 2026-09-18 07:13 UTC: "legyen a Meghiúsult".
   *
   * A BELSO KULCS MARAD `CANCELLED`. Csak a magyar felirat valtozik -- az
   * adatbazis, az atmenet-szabaly es az API valasza valtozatlan. Es a PARTNER
   * EZT A SZOT NEM LATJA: neki a szerver kulon allapot-feliratot kuld
   * (`partnerStatusLabel`), tehat ott nincs mit atirni.
   */
  CANCELLED: "Meghiúsult",
};

/**
 * MIT ERDEMES A MEGJEGYZESBE IRNI -- LEPESENKENT, ES CSAK OTT, AHOL VAN MIT.
 *
 * A MEZO ELHAGYHATO (Balazs dontese, 2026-09-03), ez tehat NEM kovetelmeny,
 * hanem segitseg. Harom lepesnel van olyan indok, amit sehol mashol nem
 * rogzitunk: az elallasnal (miert nem lesz belole munka) es a ket varakozo
 * allapotnal (kin mulik). A tobbi lepes onmagat magyarazza, es van mas nyoma is
 * -- azoknal egy odabiggyesztett kerdes csak zaj lenne.
 *
 * KIS BETUVEL KEZDODNEK ES NINCS VEGUK: a leiro mondat KOZEPEBE kerulnek, es a
 * darabszamuk a jegy allapotatol fugg. Egy kesz mondat itt vagy ismetlodne, vagy
 * ket kulonbozo alakot kellene tartani ugyanarra a szovegre.
 */
const NOTE_HINT: Partial<Record<ServiceJobStatusValue, string>> = {
  CANCELLED: "meghiúsuláskor azt, miért nem lesz belőle munka",
  WAITING_FOR_PARTS: "alkatrészre váráskor azt, milyen alkatrész és mikorra",
  WAITING_FOR_CUSTOMER: "ügyfélre váráskor azt, mit kérdeztünk és mikor",
};

/**
 * A MEZO LEIRASA, AZ ADOTT JEGY LEPESEIHEZ SZABVA.
 *
 * AZ `allowedSteps`-BOL SZUR, NEM KEZZEL SOROL: egy `Folyamatban` jegynel az
 * ellalas fel sem merul (a tabla nem engedi), tehat emliteni is felrevezeto
 * lenne. Egy kezzel irt felsorolas ezt nem tudna kovetni, es minden jegynel
 * ugyanazt mondana.
 *
 * TISZTA FUGGVENY, hogy a mondat felepitese a kepernyo felrajzolasa nelkul is
 * merheto legyen -- ugyanaz a megfontolas, mint a naplosor szovegenel.
 */
export function serviceJobNoteDescription(
  allowedSteps: readonly ServiceJobStatusValue[],
): string {
  const base =
    "Elhagyható. Ami ide kerül, a jegy naplójában marad, annál a lépésnél, amelyikhez írtad.";
  const hints = allowedSteps
    .map((step) => NOTE_HINT[step])
    .filter((hint): hint is string => hint !== undefined);
  if (hints.length === 0) return base;
  return `${base} Érdemes megírni ${hints.join("; ")}.`;
}

export function serviceJobStatusVariant(
  status: ServiceJobPartnerStatus,
): "neutral" | "success" | "info" {
  if (status === "COMPLETED") return "success";
  if (status === "NEW") return "neutral";
  return "info";
}

/**
 * A HIBAJEGY BELSŐ ÁLLAPOTÁNAK SZÍNE, Balázs 2026-09-15-i szerviz-designjában.
 *
 * SAJÁT TÁBLA, ÉS NEM A `serviceJobStatusVariant`-BÓL SZÁRMAZIK - a munkalapnál
 * fordítva helyes, itt pedig épp ez lenne a hiba. Az a függvény a PARTNER által
 * látott négy állapotot színezi; ez a nyolc BELSŐ állapotot. Két különböző
 * kérdés, két különböző bemenettel - ha ebből származtatnánk, a nyolcból három
 * maradna, és épp az veszne el, amiért a részletezés létezik: hogy az
 * alkatrészre váró jegy ne ugyanúgy nézzen ki, mint az ütemezett.
 *
 * A CSOPORTOSÍTÁS A PROTOTÍPUSBÓL VAN ÁTVÉVE (app.js, `statuses`), a színnevek
 * viszont a közös palettáéi: a terv ugyanazt a nyolc nevet használja, amit a
 * sémánk, tehát kész besorolás. Öt hang a hatból - `red` itt nem fordul elő, az
 * elállt jegy nem hiba, hanem lezárt ügy.
 *
 * `Record`, nem `switch`: egy kilencedik állapot a sémában fordítási hibát ad,
 * nem csendben `undefined` színt.
 */
const JOB_STATUS_TONE: Record<ServiceJobStatusValue, ServiceTone> = {
  NEW: "blue",
  TRIAGED: "purple",
  SCHEDULED: "purple",
  IN_PROGRESS: "purple",
  WAITING_FOR_PARTS: "amber",
  WAITING_FOR_CUSTOMER: "amber",
  COMPLETED: "green",
  CANCELLED: "neutral",
};

export function serviceJobStatusTone(
  status: ServiceJobStatusValue,
): ServiceTone {
  return JOB_STATUS_TONE[status];
}

/**
 * A MUNKALAP CÍMKÉJE A `@acropora/types`-BÓL JÖN, ÉS ITT CSAK ÁTMEGY.
 *
 * 2026-09-21-ig ennek a fájlnak a törzsében állt. A partnerportál ugyanezt a
 * sort rajzolja ki a jegy alatt, és az `apps/web` forrását nem éri el -- két
 * másolatnál ugyanaz a munkalap kétféleképpen nézne ki a két felületen.
 *
 * A RE-EXPORT AZÉRT MARAD, és nem a hívók importja lett átírva: ennek a
 * modulnak a többi címkéje (`serviceJobStatusLabel`, a megjegyzés leírása)
 * webes marad, tehát a hívóknak amúgy is innen kell importálniuk.
 */
export { serviceJobWorksheetLabel } from "@acropora/types";
