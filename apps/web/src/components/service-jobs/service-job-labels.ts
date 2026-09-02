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

export function serviceJobStatusVariant(
  status: ServiceJobPartnerStatus,
): "neutral" | "success" | "info" {
  if (status === "COMPLETED") return "success";
  if (status === "NEW") return "neutral";
  return "info";
}
