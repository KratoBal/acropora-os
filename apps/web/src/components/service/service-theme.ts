/**
 * A SZERVIZ MODUL SZINEI, EGY HELYEN.
 *
 * Balazs uj szerviz-designjabol (exchange/service-redesign-2026-09, 2026-09-15)
 * vett ertekek. A prototipus egy TELJES arculatvaltast hoz -- mas betutipust,
 * mas kiemelo szint, sotet oldalsavot --, ami az egesz alkalmazasra szol, nem
 * csak a szervizre: a tokenek helye ezert vegso soron a `globals.css` es a
 * `packages/ui`, nem ez a fajl.
 *
 * AMIG AZ A DONTES NEM SZULETETT MEG, a szinek ITT allnak, es csak a szerviz
 * lapjai hasznaljak oket. Ez szandekosan egyetlen fajl: ha az arculat
 * alkalmazas-szinten landol, ezek a konstansok kozos tokenekre cserelodnek, es
 * a csere EGY fajlra szukul. Szethintve ugyanez egy grep-vadaszat lenne
 * huszonkilenc hexadecimalis ertek utan.
 *
 * AMI NEM FER BELE: a betutipus (Inter marad, mert a `layout.tsx` kozos) es a
 * hej (oldalsav, fejlec). Ezert a szerviz lapjai ma lilak egy slate hejban --
 * ez LATHATO kulonbseg a prototipushoz kepest, nem elnezes.
 */

/** A prototipus `--purple`: a kiemelo szin, linkek es aktiv allapot. */
export const SERVICE_ACCENT = "#6150bd";

export const sv = {
  /** `.eyebrow` -- a lapcim folotti kis nagybetus sor. */
  eyebrow:
    "mb-2 text-[10px] font-bold uppercase tracking-[0.17em] text-[#6150bd]",
  /** `h1` a prototipusban: Manrope 800. Nalunk Inter, tehat a suly visz. */
  pageTitle:
    "text-[32px] font-extrabold leading-[1.25] tracking-[-0.03em] text-[#26233b]",
  pageLead: "mt-2 text-[13px] leading-relaxed text-[#686477]",

  /** `.panel` -- a feher, keretes doboz, ami a listat tartja. */
  panel: "overflow-hidden rounded-2xl border border-[#e5e2eb] bg-white",
  /** `.toolbar` -- a kereso es a szurok sora a panel tetejen. */
  toolbar:
    "flex flex-wrap items-center justify-between gap-3.5 border-b border-[#e5e2eb] px-5 py-[18px]",
  /** `.tabs` -- allapot-fulek a lista folott. */
  tabs: "flex items-center gap-5 overflow-x-auto border-b border-[#e5e2eb] px-[22px]",
  tab: "whitespace-nowrap border-b-2 border-transparent py-[15px] text-xs text-[#686477] transition-colors hover:text-[#26233b]",
  tabActive: "border-[#6150bd] font-bold text-[#6150bd]",

  /** `.search` -- a kereso mezo kerete. */
  search:
    "flex min-w-[170px] flex-1 items-center gap-2 rounded-[9px] border border-[#e5e2eb] bg-[#f6f5f8] px-[11px] sm:max-w-[330px]",
  searchInput:
    "h-[38px] w-full min-w-0 border-0 bg-transparent text-xs text-[#26233b] outline-none placeholder:text-[#9a95a8]",
  /** A toolbar jobb oldalan allo valasztok. */
  select:
    "h-[38px] rounded-[9px] border border-[#e5e2eb] bg-white px-2.5 text-xs text-[#26233b]",

  /** `table` / `th` / `td` a prototipusbol. */
  tableHead:
    "bg-[#fcfbfd] px-5 py-[13px] text-[10px] font-semibold uppercase tracking-[0.07em] text-[#686477] whitespace-nowrap",
  tableCell: "border-t border-[#efedf3] px-5 py-[18px] text-xs align-top",
  tableRow: "transition-colors hover:bg-[#fbf9ff]",
  /** `.row-title` -- a sor kattinthato cime. */
  rowTitle:
    "block text-[13px] font-semibold leading-[1.45] text-[#26233b] hover:text-[#6150bd]",
  /** `.row-meta` -- a cim alatti halvany masodsor. */
  rowMeta: "text-[11px] leading-[1.5] text-[#686477]",
  /** `.tag` -- kis lila pirula egy azonositonak. */
  tag: "inline-flex items-center gap-1.5 rounded-md bg-[#f4f1fb] px-2 py-[5px] text-[11px] text-[#635578]",
  /** `.table-footer` -- a talalatszam a lista alatt. */
  tableFooter:
    "flex items-center justify-between gap-3 border-t border-[#e5e2eb] px-5 py-3.5 text-[11px] text-[#686477]",

  /** `.tree-item` -- az eszkoz-lista helyszinfaja. */
  treeItem:
    "flex w-full items-center gap-[7px] rounded-lg px-[11px] py-[11px] text-left text-xs text-[#26233b]",
  treeItemActive: "bg-[#ede8ff] font-semibold text-[#6150bd]",
} as const;

/**
 * A PROTOTIPUS ALLAPOT-SZINEI.
 *
 * A magyar CIMKEK mar megvoltak (`worksheet-labels.ts`, `asset-labels.ts`), es
 * beture egyeznek a prototipuseval -- egyetlen szo kivetelevel (`SIGNED`: nalunk
 * "Alairva", ott "Alairt"). A mienket tartjuk meg: a cimke a felulet bevett
 * szovege, es a tesztek ra hivatkoznak. AMI UJ, az a SZIN, es itt all.
 */
export type ServiceTone =
  "neutral" | "purple" | "green" | "amber" | "red" | "blue";

export const serviceToneClass: Record<ServiceTone, string> = {
  neutral: "bg-[#eeecf3] text-[#635e72]",
  purple: "bg-[#ede8ff] text-[#5b469e]",
  green: "bg-[#e5f3eb] text-[#26664d]",
  amber: "bg-[#fff1db] text-[#86521b]",
  red: "bg-[#fce9ec] text-[#a33145]",
  blue: "bg-[#e9f0ff] text-[#355e9a]",
};
