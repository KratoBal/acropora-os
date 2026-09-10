import { categoryHandle } from "./medusa-category-handle.js";

/**
 * A KATEGORIAFA ATVITELE A MEDUSABA: a DONTES resze, a halozat nelkul.
 *
 * Mit dontunk el itt: MIT kell letrehozni, MILYEN sorrendben, MILYEN cimmel,
 * mi az, ami MAR ott van, es MILYEN LEKEPEZES-SORT kell utana irni nalunk.
 * Mit NEM: hogy a Medusa elfogadja-e. Az utobbi csak eles peldanyon merheto,
 * es azt nem en futtatom -- a hitelesites nem nalam van. A ket meres kulon
 * all, es a jelentesben is kulon jelolve.
 *
 * === A BETOLTES KET HELYRE IR, NEM EGYRE ===
 *
 * A kategoria a Medusaban keletkezik, es OTT kap egy Medusa-azonositot. A
 * vetitesnek viszont a MI kategoria-azonositoinkat kell Medusa-azonositokra
 * forditania. Ezert egy sikeres letrehozas ket dolgot hagy maga utan:
 *
 *   1. a kategoriat a Medusaban, a `external_id` mezoben a MI azonositonkkal
 *   2. egy `ExternalReference` sort nalunk (`system: MEDUSA`, `entityType:
 *      "Category"`, `entityId`: a mi azonositonk, `externalId`: a Medusa-e)
 *
 * A KETTO EGYUTT azert kell, mert ketfele iranyban kerdezunk. A
 * megismetelhetoseghez a MEDUSABAN keresunk a mi azonositonkra; a vetiteshez
 * NALUNK keresunk a Medusa-azonositora. Ha csak az egyik all, a masik iranyban
 * minden futasnak vegig kell kerdeznie a Medusat.
 *
 * A minta nem uj: a `MedusaProductLinkRepository` ugyanezt csinalja
 * termekekre, es a UNAS import ugyanezt kategoriakra a masik rendszer fele.
 *
 * === MELYIK AZONOSITO A MIENK, ES MIERT NEM MINDEGY ===
 *
 * A fa forras-fajlja (`kategoriak.xml`, UNAS export, 2026-09-02: 219 sor) az
 * UNAS kategoria-azonositoit hordozza, nem a mieinket -- merve, a fajl
 * `Azonosító` oszlopa (`742922` = "Termékek").
 *
 * A LEKEPEZES-SOR `entityId` MEZOJE VISZONT CSAK A MI `Category.id`-NK LEHET,
 * mert a vetites azzal a kezeben all. Ezert a terv bemenete a MI faank
 * (`categoryRowsFromOurTree`), es a forras-fajl olvasoja
 * (`parseCategoryTsv`) kulon all: az a fa ELLENORZESERE valo, nem a
 * betoltes bemenete.
 *
 * === ES AMIT A SZURESROL NEM TUDUNK, KIMONDVA ===
 *
 * Az `external_id` KULCSKENT letezik a kategorian -- acrobot merte a teszt
 * peldany STORE oldalan (2026-09-02, nyers valasz, a kulcs jelenletet nezve,
 * nem az erteket).
 *
 * AMIT EBBOL NEM TUDUNK: hogy az ADMIN API elfogadja-e iraskor, es hogy
 * lehet-e RA SZURNI (`?external_id=...`). Ezert ez a terv NEM epit szuresre:
 * a hivo az OSSZES kategoriat lekeri, es a parositas ITT tortenik,
 * memoriaban. 219 sornal ez nem draga.
 *
 * EZT AZERT KELL KIIRNI, mert egy kesobbi olvaso kulonben azt hinne, hogy a
 * szures letezik es csak lustasagbol nem hasznaljuk.
 */

/**
 * Egy sor a forras-fajlbol. AZ AZONOSITOK A UNAS EXPORTE, nem a mieink --
 * ezert hivjak `sourceId`-nak. Aki ezt kozvetlenul a tervbe adja, UNAS
 * azonositot ir a lekepezes-sor `entityId` mezojebe, es a vetites nem talalja
 * meg. A nev azert ilyen hosszu, hogy ez a tevedes ne tudjon csendben
 * megtortenni.
 */
export interface SourceCategoryRow {
  sourceId: string;
  parentSourceId: string | null;
  name: string;
  depth: number;
}

/** Egy csomopont a MI kategoriafankbol, ugy, ahogy a `Category` tabla tarolja. */
export interface OurCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
}

/** Egy sor a betoltes bemeneten. Az azonosito a MI `Category.id`-nk. */
export interface CategoryRow {
  ourId: string;
  parentOurId: string | null;
  name: string;
}

/** Amit a Medusa mar tud egy kategoriarol, amikor parositunk. */
/** Egy webcim-frissites: MELYIK kategoria, MIROL MIRE. */
export interface CategoryHandleUpdate {
  ourId: string;
  medusaId: string;
  /** A Medusaban MA tarolt webcim -- a csere utan mar sehol nem letezik. */
  from: string;
  /** Amit a mai szabaly ad. */
  to: string;
}

export interface ExistingCategory {
  id: string;
  externalId: string | null;
  /** A Medusaban MA tarolt webcim. Enelkul a hatodik allapot nem eldontheto. */
  handle: string;
}

/** Egy mar meglevo lekepezes-sor nalunk (`ExternalReference`, MEDUSA/Category). */
export interface CategoryMapping {
  /** `entityId`: a mi `Category.id`-nk. */
  ourId: string;
  /** `externalId`: a Medusa kategoria-azonositoja. */
  medusaId: string;
}

export interface CategoryCreate {
  ourId: string;
  /** A megjelenő cim; lasd `categoryTitle`. */
  title: string;
  /**
   * A SZULO MI azonositonk szerint, nem a Medusa-e. A Medusa-oldali azonosito
   * csak a letrehozas UTAN letezik, es a hivo dolga feloldani -- ezert all a
   * sorrend-ellenorzes (`firstOutOfOrder`).
   */
  parentOurId: string | null;
}

/**
 * Ugyanahhoz a kategoriahoz KET Medusa-azonosito all: a lekepezes-sorunk
 * egyre mutat, a mi azonositonkat viszont egy MASIK kategoria hordozza.
 * Nem javitjuk magunktol -- lasd a `planCategoryImport` jegyzetet.
 */
export interface CategoryMappingConflict {
  ourId: string;
  /** Amire a lekepezes-sorunk mutat. */
  mappedMedusaId: string;
  /** Ami a Medusaban a mi azonositonkat hordozza. */
  medusaIdCarryingOurId: string;
}

export interface CategoryImportPlan {
  /** Amit letre kell hozni a Medusaban, LETREHOZASI sorrendben. */
  create: CategoryCreate[];
  /** Amivel nincs teendo: all a Medusaban ES all a lekepezes-sora is. */
  skip: string[];
  /**
   * All a Medusaban, de NINCS lekepezes-sora nalunk. Nem kell letrehozni,
   * CSAK a sort megirni. Ez az allapot egy felbeszakadt futas utan all elo:
   * a Medusa mar megkapta, mi meg nem jegyeztuk fel.
   */
  mapOnly: CategoryMapping[];
  /**
   * Van lekepezes-sorunk, de a Medusaban NINCS meg a kategoria. A sorunk
   * hazudik: ezek a `create` listaban is ott allnak, es a lekepezes-sort
   * FELUL kell irni, nem beszurni.
   *
   * Kulon nevesitve, mert ez azt jelenti, hogy valaki torolt a Medusaban --
   * az egy esemeny, nem egy csendben gyogyithato allapot.
   */
  staleMapping: string[];
  /** Amihez ket kulonbozo Medusa-azonosito tartozik. Lasd lent. */
  conflict: CategoryMappingConflict[];
  /**
   * A HATODIK ALLAPOT: mar all a Medusaban, a lekepezes is helyes, DE a tarolt
   * webcime elter attol, amit a mai szabaly adna.
   *
   * MIERT KELL KULON, ES MIERT NEM A `skip` RESZE: az ot korabbi allapot
   * mindegyike a LETEZESROL szolt (van-e ott, van-e sorunk ra). Ez az elso, ami
   * a TARTALMAROL -- es ezert az egyetlen, ami frissit, nem letrehoz.
   *
   * A `from` MEZO NEM DISZ. A kisbetusites es a karakter-csere EGYIRANYU: a
   * csere utan a regi cim SEHOL nem letezik tobbe. Ha valaha kiderul, hogy egy
   * regi cim kint van (kepernyokep, levelezes, megosztott hivatkozas), a
   * regi-uj par az EGYETLEN, amibol atiranyitas kesziheto.
   */
  handleUpdate: CategoryHandleUpdate[];
}

/** A fejlec utan minden sor egy kategoria. Tab-elvalasztott. */
export function parseCategoryTsv(text: string): SourceCategoryRow[] {
  const sorok = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  const fejlec = sorok.shift();
  if (!fejlec) return [];
  const oszlopok = fejlec.split("\t");
  const idx = (nev: string) => {
    const i = oszlopok.indexOf(nev);
    if (i === -1) throw new Error(`Hiányzó oszlop a fa-fájlban: ${nev}`);
    return i;
  };
  const iAz = idx("azonosito");
  const iSzulo = idx("szulo_azonosito");
  const iNev = idx("nev");
  const iMelyseg = idx("melyseg");
  return sorok.map((sor, i) => {
    const m = sor.split("\t");
    const sourceId = (m[iAz] ?? "").trim();
    /**
     * URES AZONOSITOVAL NEM MEGYUNK TOVABB.
     *
     * A kulso azonosito a parositas EGYETLEN kulcsa. Egy ures ertek
     * CSENDBEN egyezne barmivel, aminek szinten nincs azonositoja -- peldaul a
     * gyari bemutato kategoriakkal --, es akkor a sajat kategoriank
     * "mar letezik" cimen kimaradna. A hiba a betoltes VEGEN latszana, egy
     * hianyzo agkent, es senki nem tudna, melyik sorbol.
     *
     * (Ezt a kalibracio hozta elo: az elso valtozatban csak egy allitas allt
     * arrol, hogy az ures azonosito ne takarjon el semmit -- es a celzott
     * rontas NEM pirositotta ki, mert a fixturaban nem volt ures azonositoju
     * sor. Az allitas nem mert semmit. Igy a kerdes fel sem merul.)
     */
    if (!sourceId)
      throw new Error(`Üres azonosító a fa-fájl ${i + 2}. sorában.`);
    return {
      sourceId,
      parentSourceId: (m[iSzulo] ?? "").trim() || null,
      name: (m[iNev] ?? "").trim(),
      depth: Number.parseInt(m[iMelyseg] ?? "0", 10),
    };
  });
}

/**
 * A MI FANKBOL csinal betoltheto sorokat, SZULO-ELOSZOR sorrendben.
 *
 * MIERT RENDEZUNK ITT, HOLOTT A FORRAS-FAJLNAL NEM. A fajl sorrendje ALLITAS
 * a forrasrol: ha elromlik, azt tudni akarjuk, nem csendben helyrerakni. Egy
 * adatbazis-lekerdezes sorrendje viszont nem allit semmit -- ott a sorrendet
 * nem helyreallitjuk, hanem eloallitjuk. A ketto nem ugyanaz a muvelet.
 *
 * KET DOLOGRA HANGOSAN ELHASAL, mert mindketto csendben egy hianyzo agat
 * jelentene a betoltes vegen:
 *   - a szulo a halmazon KIVUL van (szurt lekerdezes vagta le)
 *   - kor van a faban (a `Category.parentId` ezt nem zarja ki)
 */
export function categoryRowsFromOurTree(
  nodes: readonly OurCategoryNode[],
): CategoryRow[] {
  const gyerekek = new Map<string | null, OurCategoryNode[]>();
  const ismert = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.parentId && !ismert.has(node.parentId))
      throw new Error(
        `A(z) ${node.id} kategória szülője (${node.parentId}) nincs a halmazban.`,
      );
    const kulcs = node.parentId ?? null;
    const lista = gyerekek.get(kulcs);
    if (lista) lista.push(node);
    else gyerekek.set(kulcs, [node]);
  }
  const sorok: CategoryRow[] = [];
  const bejar = (szuloId: string | null) => {
    for (const node of gyerekek.get(szuloId) ?? []) {
      sorok.push({
        ourId: node.id,
        parentOurId: node.parentId ?? null,
        name: node.name,
      });
      bejar(node.id);
    }
  };
  bejar(null);
  if (sorok.length !== nodes.length)
    throw new Error(
      `Kör van a kategóriafában: ${nodes.length} csomópontból ${sorok.length} érhető el a gyökerekből.`,
    );
  return sorok;
}

/**
 * AZOK A NEVEK, AMIK TOBBSZOR ELOFORDULNAK A FABAN.
 *
 * Halmaz-szintu teny: egyetlen kategoriabol NEM eldontheto. Ezert kulon
 * fuggveny, es ezert kapja a `categoryTitle` KIVULROL -- ha maga szamolna, a
 * hivonak at kellene adnia a teljes fat egy olyan fuggvenynek, ami egyetlen
 * cimet keszit.
 *
 * A GYOKEREK IS BENNE VANNAK a szamolasban. Nekik nincs szulojuk, tehat a
 * cimuk ugyis rovid marad -- de ha egy gyoker neve utkozne egy melyebb
 * kategorival, a MELYEBB viszi a szulot, es ez igy helyes.
 */
export function utkozoNevek(
  rows: readonly { name: string }[],
): ReadonlySet<string> {
  const db = new Map<string, number>();
  for (const sor of rows) db.set(sor.name, (db.get(sor.name) ?? 0) + 1);
  const ki = new Set<string>();
  for (const [nev, n] of db) if (n > 1) ki.add(nev);
  return ki;
}

/**
 * A MEGJELENO CIM. KULON FUGGVENY, ES EZ NEM STILUS.
 *
 * === A SZABALY, ES HOGY KI DONTOTTE EL ===
 *
 * Balazs 2026-09-04-en a SZUKEBB valtozatra mondott igent (szo szerint: "ok.
 * legyen a masodik"): a szulo neve CSAK akkor kerul a cimbe, ha a kategoria
 * neve TOBBSZOR is elofordul a faban. Az egyedi nevu kategoriak rovid nevet
 * kapnak.
 *
 * A dontes 2026-09-04-i, es 2026-09-10-ig nem epult meg, mert nem volt rola
 * kartya (c0642418).
 *
 * === A MERES, AMIN A DONTES ALL, MA IS UGYANAZ ===
 *
 * A stage Medusa teljes listajan (219 kategoria, 2026-09-10, nautilus, a
 * gyokerekbol lefele feloldva):
 *
 *     kulonbozo tiszta nev      169
 *     tobbszor elofordulo        27      (Aquaforest 7, Red Sea 5, Fauna Marin 5)
 *     ERINTETT (viszi a szulot)  77
 *     EGYEDI (rovid nev)        142
 *
 * Beture ugyanaz a negy szam, amire a dontes epult -- csak a mai elo adatbol.
 *
 * === AMI NINCS ITT, ES SZANDEKOSAN NINCS: VISSZAFEJTES ===
 *
 * Ez a fuggveny a szulo nevet HOZZAADJA, sosem fejti vissza. Aki egyszer
 * "vagd le az utolso ' - ' utani reszt" agat tesz ide vagy a kirakatba, EGY
 * MEGLEVO eseten tevedne: az "RKS - Fogyashoz igazitott nyomelem rendszer"
 * tiszta neve MAGA tartalmaz " - "-t.
 */
export function categoryTitle(
  name: string,
  parentName: string | null,
  utkozik: boolean,
): string {
  return parentName && utkozik ? `${name} - ${parentName}` : name;
}

/**
 * A SORREND ELLENORZESE: a szulo MINDIG korabban all, mint a gyereke.
 *
 * MIERT ALLITAS, ES NEM RENDEZES. A letrehozas az elso mely kategorianal
 * hasalna el, mert a szulo Medusa-azonositoja meg nem letezik. Ha a bemenet
 * a `categoryRowsFromOurTree`-tol jon, ez mar teljesul -- de a terv nem
 * felteheti, hogy onnan jott.
 */
export function firstOutOfOrder(rows: readonly CategoryRow[]): string | null {
  const latott = new Set<string>();
  for (const sor of rows) {
    if (sor.parentOurId && !latott.has(sor.parentOurId)) return sor.ourId;
    latott.add(sor.ourId);
  }
  return null;
}

/**
 * MIT KELL LETREHOZNI, MIT NEM, ES MIT KELL FELJEGYEZNI.
 *
 * A megismetelhetoseg KET forrasbol dol el, es a ketto szetcsuszhat: a
 * Medusaban allo kategoriakbol (`existing`) es a sajat lekepezes-sorainkbol
 * (`mappings`). Ot allapot all elo, es mind az otnek MAS a teendoje:
 *
 *   Medusaban | nalunk sor | teendo
 *   ----------+------------+---------------------------------------------
 *   nincs     | nincs      | letrehozas, majd uj lekepezes-sor  (create)
 *   VAN       | nincs      | CSAK a sort megirni                (mapOnly)
 *   nincs     | VAN        | ujra letrehozni, a sort FELULIRNI  (staleMapping)
 *   VAN       | VAN, egyez | semmi                              (skip)
 *   VAN       | VAN, MAS   | megallni                           (conflict)
 *
 * MIERT ALL MEG AZ UTOLSO, HOLOTT "nyilvan a Medusa az igazsag". Mert nem
 * tudjuk, melyik a helyes: lehet, hogy a sorunk mutat egy halott azonositora,
 * es lehet, hogy valaki kezzel adta a mi azonositonkat egy MASIK kategorianak.
 * Az elsot javitani kell, a masodikat NEM SZABAD -- a felulirassal elvesznenek
 * a termek-hozzarendelesek azon a kategorian. A hivo tudja, honnan jott az
 * utkozo ertek; a terv nem. (Ugyanez a dontes all a
 * `MedusaProductLinkRepository`-ban is, ugyanezzel az indokkal.)
 *
 * A HARMADIK viszont MAGATOL javul, es ez nem ellentmondas: ott MERTUK, hogy a
 * Medusa oldalan nincs semmi. Nincs mit arvan hagyni. A kulonbseg nem a
 * batorsag, hanem az, hogy az egyik allapotot lattuk, a masikat nem.
 */
export function planCategoryImport(
  rows: readonly CategoryRow[],
  existing: readonly ExistingCategory[],
  mappings: readonly CategoryMapping[] = [],
): CategoryImportPlan {
  const nevek = new Map(rows.map((sor) => [sor.ourId, sor.name]));
  const medusaIdMiAzonositonkra = new Map<string, string>();
  for (const cat of existing)
    if (cat.externalId) medusaIdMiAzonositonkra.set(cat.externalId, cat.id);
  const sorunk = new Map(mappings.map((m) => [m.ourId, m.medusaId]));

  const taroltHandle = new Map(existing.map((cat) => [cat.id, cat.handle]));

  const create: CategoryCreate[] = [];
  const skip: string[] = [];
  const mapOnly: CategoryMapping[] = [];
  const staleMapping: string[] = [];
  const conflict: CategoryMappingConflict[] = [];
  const handleUpdate: CategoryHandleUpdate[] = [];

  /*
   * EGYSZER SZAMOLJUK KI, es a TELJES sorhalmazon -- nem soronkent. Egy
   * soronkenti szamolas ugyanezt adna, csak N-szer, es a kovetkezo olvaso nem
   * latna, hogy a teny a HALMAZE, nem a soré.
   */
  const utkozo = utkozoNevek(rows);

  /**
   * A HATODIK ALLAPOT FELVETELE. Csak ott, ahol a kategoria MAR ALL es a
   * lekepezes rendben van -- utkozesnel NEM nyulunk hozza, mert ott azt sem
   * tudjuk, melyik sor a helyes.
   */
  const frissitendo = (ourId: string, medusaId: string, cim: string) => {
    const tarolt = taroltHandle.get(medusaId);
    if (tarolt === undefined) return;
    const kell = categoryHandle(cim);
    if (tarolt !== kell)
      handleUpdate.push({ ourId, medusaId, from: tarolt, to: kell });
  };

  for (const sor of rows) {
    const aMedusaban = medusaIdMiAzonositonkra.get(sor.ourId) ?? null;
    const aSorunk = sorunk.get(sor.ourId) ?? null;

    const cim = categoryTitle(
      sor.name,
      sor.parentOurId ? (nevek.get(sor.parentOurId) ?? null) : null,
      utkozo.has(sor.name),
    );

    if (aMedusaban && aSorunk) {
      if (aSorunk === aMedusaban) {
        skip.push(sor.ourId);
        frissitendo(sor.ourId, aMedusaban, cim);
      } else
        conflict.push({
          ourId: sor.ourId,
          mappedMedusaId: aSorunk,
          medusaIdCarryingOurId: aMedusaban,
        });
      continue;
    }

    if (aMedusaban) {
      mapOnly.push({ ourId: sor.ourId, medusaId: aMedusaban });
      frissitendo(sor.ourId, aMedusaban, cim);
      continue;
    }

    if (aSorunk) staleMapping.push(sor.ourId);
    create.push({
      ourId: sor.ourId,
      title: cim,
      parentOurId: sor.parentOurId,
    });
  }
  return { create, skip, mapOnly, staleMapping, conflict, handleUpdate };
}
