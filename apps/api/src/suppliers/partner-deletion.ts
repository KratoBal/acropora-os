/**
 * Mi tartja vissza egy partner fizikai törlését, és mi megy vele együtt.
 *
 * A lista EGY helyen áll, nevesítve, és szándékosan nem az adatbázis
 * viselkedése szerint van csoportosítva. A `RESTRICT` relációk hibát dobnának,
 * tehát látszanak; a `SET NULL` relációk viszont CSENDBEN vinnék el az adatot:
 * egy fizikai törlés után egy régi értékesítési rendelésről, projektről vagy
 * akváriumból eltűnne a partner neve, hibaüzenet nélkül. Ha a döntést az
 * adatbázis viselkedésére bíznánk, pont az a fele maradna ki, amelyik nem
 * szól.
 *
 * A megkülönböztetés, ami MARAD, más tengely: egy bejegyzés RÁ HIVATKOZIK,
 * vagy A RÉSZE. Amit vele együtt hoztunk létre (a beszállítói
 * termékkapcsolatok, a tükör vevő-sor címei), az vele is megy, és nem tartja
 * vissza a törlést - de a megerősítő kérdésben meg kell nevezni, mert a
 * felhasználó azt is elveszíti.
 */

/** Egy hivatkozás-fajta, ahogy a felhasználó ismeri. */
export interface PartnerReferenceKind {
  key: string;
  /** Egyes szám, kisbetűvel: a mondatba így illik bele. */
  label: string;
  /**
   * `blocks`: más bejegyzés hivatkozik a partnerre, tehát a sort meg kell
   * tartani, különben a régi bejegyzésről eltűnik a név.
   * `cascades`: a partnerrel együtt keletkezett, vele is megy.
   */
  effect: "blocks" | "cascades";
}

/**
 * Mind a tizenöt hivatkozás, amit a séma ma megenged: hat a partner sorára, és
 * kilenc a tükör vevő-sorára. (A tizenhatodik reláció maga a tükör-kapcsolat,
 * az nem hivatkozás, hanem a partner belső részlete.)
 */
export const PARTNER_REFERENCE_KINDS: readonly PartnerReferenceKind[] = [
  // A partner sorára mutatnak.
  {
    key: "supplierProducts",
    label: "beszállítói termékkapcsolat",
    effect: "cascades",
  },
  {
    key: "preferredByExtensions",
    label: "termék, aminek ő az elsődleges beszállítója",
    effect: "blocks",
  },
  { key: "purchaseOrders", label: "beszerzési rendelés", effect: "blocks" },
  { key: "purchaseInvoices", label: "beszerzési számla", effect: "blocks" },
  { key: "supplierInvoices", label: "számla", effect: "blocks" },
  { key: "supplierAssets", label: "eszköz", effect: "blocks" },
  // A tükör vevő-sorára mutatnak. A partner munkalapjai ezen keresztül
  // kapcsolódnak, tehát ez nem külön rendszer, hanem ugyanaz a partner.
  {
    key: "mirrorAddresses",
    label: "cím a tükör vevő-soron",
    effect: "cascades",
  },
  { key: "salesOrders", label: "értékesítési rendelés", effect: "blocks" },
  { key: "projects", label: "projekt", effect: "blocks" },
  { key: "serviceJobs", label: "szerviz munka", effect: "blocks" },
  { key: "aquariums", label: "akvárium", effect: "blocks" },
  { key: "customerInvoices", label: "számla (vevőként)", effect: "blocks" },
  { key: "customerAssets", label: "eszköz (vevőként)", effect: "blocks" },
  { key: "worksheetDepartments", label: "alegység", effect: "blocks" },
  { key: "worksheets", label: "munkalap", effect: "blocks" },
];

export type PartnerReferenceCounts = Record<string, number>;

export interface PartnerReferenceSummary {
  label: string;
  count: number;
}

export type PartnerDeletionPlan =
  | {
      /** Semmi nem hivatkozik rá: a sor mehet. */
      action: "delete";
      /** Ami vele együtt megy. Üres is lehet. */
      alsoRemoved: PartnerReferenceSummary[];
    }
  | {
      /** Hivatkoznak rá: a sor marad, törölt jelöléssel. */
      action: "mark-deleted";
      /** Ami visszatartja, a felhasználó nyelvén. */
      blockedBy: PartnerReferenceSummary[];
    };

function summarise(
  counts: PartnerReferenceCounts,
  effect: PartnerReferenceKind["effect"],
): PartnerReferenceSummary[] {
  return PARTNER_REFERENCE_KINDS.filter(
    (kind) => kind.effect === effect && (counts[kind.key] ?? 0) > 0,
  ).map((kind) => ({ label: kind.label, count: counts[kind.key] ?? 0 }));
}

/**
 * A döntés, számokból. Adatbázis nélkül eldönthető, tehát tesztelhető is.
 *
 * Egyetlen hivatkozó bejegyzés is elég a törölt jelöléshez. Nem a mennyiség
 * számít, hanem hogy van-e olyan régi bejegyzés, amiről eltűnne a név.
 */
export function planPartnerDeletion(
  counts: PartnerReferenceCounts,
): PartnerDeletionPlan {
  const blockedBy = summarise(counts, "blocks");
  if (blockedBy.length > 0) return { action: "mark-deleted", blockedBy };
  return { action: "delete", alsoRemoved: summarise(counts, "cascades") };
}
