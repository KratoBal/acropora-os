/**
 * A SZERVIZ MODUL OSZTALY-KESZLETE, EGY HELYEN.
 *
 * Balazs uj szerviz-designjabol (exchange/service-redesign-2026-09, 2026-09-15).
 * Ez a fajl a szerviz lapjainak az ELRENDEZESET tartja: meretek, tavolsagok,
 * keretek, tipografia -- azt, amit a prototipus a sajat osztalyaival ir le.
 *
 * A SZINEKET VISZONT MAR NEM: azok a kozos tokenekbol jonnek (`ink`, `muted`,
 * `line`, `brand-*`, `paper`), amiket az arculat beolvasztasa hozott letre
 * (#660). Egy ide masolt hexa MASODIK IGAZSAG-FORRAS lenne ugyanarra a szinre:
 * ha a tokenben modosul a lila, ez a fajl nem kovetne, es senki nem szolna rola.
 *
 * NEHANY ERTEK MEGIS NYERSEN ALL a szerviz fajljaiban, es ez szandekos. A
 * prototipus hasznal nehany KOZBENSO arnyalatot, amikhez ma nincs token: a
 * tablazat sorvalasztoja es fejlec-hattere, a sor fole huzott halvany lila, a
 * pirula-szovegek, es a csempe kiemelo kerete. Ezeket NEM kerekitettem a
 * legkozelebbi tokenre: egy "majdnem ugyanaz" megfeleltetes megvaltoztatna a
 * szint, es a diffbol nem latszana, hogy az dontes volt. Ha valamelyik masodszor
 * is kell valahol, akkor lesz belole token -- akkor, es nem elore.
 *
 * ES AMIT A "MASODSZOR" MER, mert a szabaly maga jo volt, a merese viszont
 * alulhatarozott: HASZNALATOT szamol, nem ELOFORDULAST. Egy ertek, ami
 * masodszor csak egy magyarazo megjegyzesben all, egyszer hasznalt. Ha a
 * komment-emlites tokent szulne, a sajat dokumentacionk hatarozna meg a kod
 * alakjat -- es a kereses, ami ezt szamolja, epp azt nem tudja megkulonboztetni.
 *
 * ES AZONOS ERTEK MEG NEM AZONOS DONTES. Ha ket hely ugyanazt a szamot irja le,
 * de KULONBOZO kerdesre valaszol vele (mas hatter, mas szerep), akkor ket dontes
 * all ott, ami MA egybeesik. Egy nev ala huzva a kovetkezo hangolas mind a kettot
 * elvinne, holott csak az egyiket akartak -- vagyis a token pont azt tenne
 * lehetetlenne, amiert letezik: hogy EGY helyen at lehessen allitani. Elo pelda
 * lentebb a `tag`, aminek a szovegszine beture egyezik egy tokennel, es megsem az.
 *
 * ATKOLTOZOTT IDE `apps/web/src/components/service/` alol, 2026-09-24
 * (partner hibajegy-lapok arculati parositasa). Az eredeti fajl azt indokolta,
 * miert NEM itt lakik: "ha az arculat alkalmazas-szinten landol, ezek felmennek
 * a kozos csomagba". Az `apps/partner` `visual-base.spec.ts` orzoje csak
 * `@acropora/ui`-bol engedi az importot, tehat a felteteler most teljesul: a
 * hibajegy-lista es -adatlap a partner-portalon UGYANEZT a keretet hasznalja.
 * Az `apps/web` sajat fajlja innentol UJRAEXPORTAL -- a kod es a kimenet
 * valtozatlan, csak a hely mas.
 */

export const sv = {
  /** `.eyebrow` -- a lapcim folotti kis nagybetus sor. */
  eyebrow:
    "mb-2 text-[10px] font-bold uppercase tracking-[0.17em] text-brand-700",
  /**
   * A LAP CIME. A prototipusban `h1{font-size:32px}`, es a betutipus 2026-09-15
   * ota nalunk is Manrope: az arculat (#660) `h1,h2,h3` elem-szabalya adja. A
   * korabbi megjegyzes meg azt mondta, hogy "nalunk Inter, tehat a suly visz" --
   * az a mondat az arculat beolvasztasaval elavult.
   *
   * EZ A LISTAK ES AZ URLAPOK MERETE. Az adatlapoke kisebb, lentebb.
   */
  pageTitle:
    "text-[32px] font-extrabold leading-[1.25] tracking-[-0.03em] text-ink",
  /**
   * AZ ADATLAP CIME, 29 pixel -- es ez nem masik meret, hanem MODOSITO.
   *
   * A prototipus `styles.css`-eben `.detail-head h1{max-width:700px;font-size:29px}`
   * all, vagyis a 32 pixel felulirasa, KIZAROLAG a harom adatlapon. Az urlapok
   * es a listak sima `page-head`-et kapnak, tehat 32-t.
   *
   * MIERT ITT ALL, ES NEM A KOMPONENSBEN: eddig a 32 tokenben volt, a 29 pedig
   * kezzel a `service-detail-chrome.tsx`-ben -- ugyanarra a dologra ket forras.
   * Pontosan az, amire ennek a fajlnak a fejlec-megjegyzese figyelmeztet a
   * szineknel.
   */
  detailTitle:
    "max-w-[700px] text-[29px] font-extrabold leading-[1.25] tracking-[-0.03em] text-ink",
  pageLead: "mt-2 text-[13px] leading-relaxed text-muted",

  /** `.panel` -- a feher, keretes doboz, ami a listat tartja. */
  panel: "overflow-hidden rounded-2xl border border-line bg-white",
  /** `.toolbar` -- a kereso es a szurok sora a panel tetejen. */
  toolbar:
    "flex flex-wrap items-center justify-between gap-3.5 border-b border-line px-5 py-[18px]",
  /** `.tabs` -- allapot-fulek a lista folott. */
  tabs: "flex items-center gap-5 overflow-x-auto border-b border-line px-[22px]",
  tab: "whitespace-nowrap border-b-2 border-transparent py-[15px] text-xs text-muted transition-colors hover:text-ink",
  tabActive: "border-brand-700 font-bold text-brand-700",

  /** `.search` -- a kereso mezo kerete. */
  search:
    "flex min-w-[170px] flex-1 items-center gap-2 rounded-[9px] border border-line bg-paper px-[11px] sm:max-w-[330px]",
  searchInput:
    "h-[38px] w-full min-w-0 border-0 bg-transparent text-xs text-ink outline-none placeholder:text-dusk-400",
  /** A toolbar jobb oldalan allo valasztok. */
  select:
    "h-[38px] rounded-[9px] border border-line bg-white px-2.5 text-xs text-ink",

  /** `table` / `th` / `td` a prototipusbol. */
  tableHead:
    "bg-[#fcfbfd] px-5 py-[13px] text-[10px] font-semibold uppercase tracking-[0.07em] text-muted whitespace-nowrap",
  tableCell: "border-t border-[#efedf3] px-5 py-[18px] text-xs align-top",
  tableRow: "transition-colors hover:bg-[#fbf9ff]",
  /** `.row-title` -- a sor kattinthato cime. */
  rowTitle:
    "block text-[13px] font-semibold leading-[1.45] text-ink hover:text-brand-700",
  /** `.row-meta` -- a cim alatti halvany masodsor. */
  rowMeta: "text-[11px] leading-[1.5] text-muted",
  /**
   * `.tag` -- kis lila pirula egy azonositonak.
   *
   * A SZOVEG SZINE NYERSEN ALL, PEDIG BETURE AZONOS A `brand-muted`-tel -- es ez
   * NEM elmaradt sopres. Az a token a KIEMELT PANEL leiro szovege, `brand-100`
   * hatteren; ez egy PIRULA szovege, `brand-50`-en. Ket kulonbozo dontes,
   * ugyanazzal a mai ertekkel.
   *
   * Egy tokenbe huzva azt allitanank, hogy egyek, es a kovetkezo, aki a panel
   * szoveget hangolja, ezt is elvinne -- egy MASIK hatteren, ahol a kontraszt
   * mas. Ha ennek is kell egyszer nev, sajat nevet kap.
   */
  tag: "inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-[5px] text-[11px] text-[#635578]",
  /** `.table-footer` -- a talalatszam a lista alatt. */
  tableFooter:
    "flex items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[11px] text-muted",

  /** `.tree-item` -- az eszkoz-lista helyszinfaja. */
  treeItem:
    "flex w-full items-center gap-[7px] rounded-lg px-[11px] py-[11px] text-left text-xs text-ink",
  treeItemActive: "bg-brand-100 font-semibold text-brand-700",
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
  neutral: "bg-dusk-100 text-[#635e72]",
  purple: "bg-brand-100 text-brand-ink",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-rose-50 text-rose-700",
  blue: "bg-sky-50 text-sky-700",
};
