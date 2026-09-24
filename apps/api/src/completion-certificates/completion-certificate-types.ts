import type { DecimalInput } from "./completion-certificate-amounts.js";

/**
 * EGY TÉTEL A TELJESÍTÉSI IGAZOLÁSON.
 *
 * A minta (`exchange/minta-teljesitesi-igazolas-allatkert.pdf`, "ÁLT #2026-12")
 * egy soron mutatja: "Cápasuli akvárium felügyeleti rendszerek / Karbantartása
 * és ellenőrzése elvégzésre került. / Szerződésszám: SZ2026/0000019" a
 * megnevezés oszlopban, "3 alkalom" a mennyiségben, "700 000" az egységárban,
 * "27%" az ÁFA-ban.
 */
export interface CompletionCertificateItem {
  /** A tétel neve, félkövéren a minta szerint (pl. "Cápasuli akvárium
   * felügyeleti rendszerek"). */
  description: string;
  /** A megnevezés alatti magyarázó sor (pl. "Karbantartása és ellenőrzése
   * elvégzésre került."). Elhagyható. */
  detail?: string;
  /** A szerződésszám, a tétel sorában (pl. "SZ2026/0000019"). Elhagyható,
   * mert nem minden tétel biztos, hogy szerződéshez kötött. */
  contractNumber?: string;
  quantity: DecimalInput;
  /** A mennyiség egysége (pl. "alkalom", "db"). */
  quantityUnit: string;
  /** Nettó egységár, egy mennyiségi egységre. */
  unitPrice: DecimalInput;
  vatRatePercent: DecimalInput;
}

/**
 * A minta ügyfél-blokkja négy sort mutat: név, cím (két sorban), adószám.
 * Egy ötödik sor is áll ott ("PP Üzemeltetés"), aminek NINCS ismert forrása
 * a mai folyamatban (nem szerepel sem a szerződés-, sem a hibajegy-modell
 * egyetlen mezőjében sem, amit ez a kör lát) -- ezért `contactLine`-ként,
 * ELHAGYHATÓAN szerepel itt, és a PR törzse külön felsorolja.
 */
export interface CompletionCertificateCustomer {
  name: string;
  addressLines: readonly string[];
  taxNumber?: string;
  /** Lásd a fenti megjegyzést: ismeretlen forrású mező a mintából. */
  contactLine?: string;
}

/**
 * A TELJESÍTÉSI IGAZOLÁS BEMENETE -- SAJÁT, LAPOS TÍPUS.
 *
 * SZÁNDÉKOSAN NEM importál semmit a Contract/ServiceJob modellből (az Codex
 * szeletére épül, ami ekkor még nem létezett/nem stabil): a bekötéskor a
 * hívó oldal felelőssége, hogy ezekre a mezőkre leképezze a saját adatait.
 */
export interface CompletionCertificateInput {
  /** A bizonylat száma (pl. "ÁLT #2026-12"). */
  certificateNumber: string;
  issuedAt: Date;
  completedAt: Date;
  /** A "Tárgy" sor -- mit végeztünk el. */
  subject: string;
  /** A "[Munkalap ÁLT #2026-31]" jellegű hivatkozás a tárgy alatt.
   * ELHAGYHATÓ: a minta EGY munkalapra hivatkozik, de nem ismert, hogy egy
   * teljesítési igazolás mindig pontosan egy munkalaphoz tartozik-e -- ezt a
   * bekötéskor kell eldönteni, itt csak egy szabad szöveg a helye. */
  worksheetReference?: string;
  customer: CompletionCertificateCustomer;
  items: readonly CompletionCertificateItem[];
  /** Az aláíró neve (pl. "Kratochwill Balázs"). ELHAGYHATÓ: nincs ismert
   * forrása a mai folyamatban, hogy ez mindig ugyanaz a személy-e, vagy
   * bizonylatonként változik. */
  signerName?: string;
  /** Az aláíró e-mail címe. Ugyanaz a fenntartás, mint a névnél. */
  signerEmail?: string;
}
