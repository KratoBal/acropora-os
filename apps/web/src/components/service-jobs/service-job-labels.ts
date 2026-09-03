import type {
  ServiceJobPartnerStatus,
  ServiceJobStatusValue,
} from "@acropora/types";

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
  CANCELLED: "Elállt",
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
  CANCELLED: "elálláskor azt, miért nem lesz belőle munka",
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
