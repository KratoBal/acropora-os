import type { ServiceJobStatusValue } from "@/lib/api/service-jobs";

/**
 * A HIBAJEGY ÁLLAPOTAINAK MAGYAR NEVE -- KÉZZEL KARBANTARTOTT TÜKÖR.
 *
 * A forrás: `apps/web/src/components/service-jobs/service-job-labels.ts`. Az
 * Expo app szándékosan nem húzza be a munkatér csomagjait, tehát importálni nem
 * lehet -- ugyanaz a helyzet, mint a matricakódnál és a teljesítmény-alaknál.
 *
 * ÉS EZ A TÜKÖR KEVESEBBET KOCKÁZTAT, MINT AZOK, ezért nincs mellette összevető
 * őrző: itt SZÖVEG áll, nem SZABÁLY. Ha egy felirat elcsúszik, a szerelő más
 * szót lát, mint az irodás -- kellemetlen, de LÁTHATÓ. Ha egy SZABÁLY csúszik
 * el (mit szabad lépni, mi az érvényes alak), a hiba néma, és a szerver utasítja
 * el azt, amit a telefon átengedett.
 *
 * AMI VISZONT NINCS ITT, ÉS SZÁNDÉKOSAN: a LÉPÉS-szabály. Azt a szerver küldi a
 * jegy mellett (`allowedSteps`), tehát nincs mit tükrözni.
 */
export const SERVICE_JOB_STATUS_LABELS: Record<ServiceJobStatusValue, string> =
  {
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
 * AZ ÁLLAPOT NEVE, VAGY MAGA A KÓD.
 *
 * ISMERETLEN ÉRTÉKRE A KÓDOT ADJA VISSZA, nem üres szöveget: ha a szerver egy új
 * állapotot vezet be, mielőtt ez a tükör bővül, a szerelő lásson VALAMIT. Egy
 * üres cella azt állítaná, hogy a jegynek nincs állapota.
 */
export function serviceJobStatusLabel(status: string): string {
  return SERVICE_JOB_STATUS_LABELS[status as ServiceJobStatusValue] ?? status;
}

/**
 * A HELYSZÍN ÚTJA EGY SORBAN.
 *
 * A szerver a teljes utat adja, a gyökértől lefelé (`departmentPath`). A telefon
 * képernyője keskeny, ezért a VÉGE a fontos: ahol a gép áll. Ha az út hosszabb
 * kettőnél, az eleje elmarad -- de a rövidítés LÁTSZIK (`...`), nem csendes.
 */
export function shortPath(path: readonly string[] | null): string | null {
  if (!path || path.length === 0) return null;
  if (path.length <= 2) return path.join(" / ");
  return `... / ${path.slice(-2).join(" / ")}`;
}
