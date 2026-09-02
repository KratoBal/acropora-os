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
export interface ExistingCategory {
  id: string;
  externalId: string | null;
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
 * A MEGJELENO CIM. KULON FUGGVENY, ES EZ NEM STILUS.
 *
 * A mai szabaly: `{nev} - {szulo neve}`, es polip merte, hogy ez a hetvenhat
 * utkozo nevre NULLA utkozest hagy. A SZABALY ELFOGADASA VISZONT BALAZSE, es
 * meg nem tortent meg -- ezert all egy helyen: ha mast valaszt, EZ az egy
 * fuggveny valtozik, nem a betoltes.
 */
export function categoryTitle(name: string, parentName: string | null): string {
  return parentName ? `${name} - ${parentName}` : name;
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

  const create: CategoryCreate[] = [];
  const skip: string[] = [];
  const mapOnly: CategoryMapping[] = [];
  const staleMapping: string[] = [];
  const conflict: CategoryMappingConflict[] = [];

  for (const sor of rows) {
    const aMedusaban = medusaIdMiAzonositonkra.get(sor.ourId) ?? null;
    const aSorunk = sorunk.get(sor.ourId) ?? null;

    if (aMedusaban && aSorunk) {
      if (aSorunk === aMedusaban) skip.push(sor.ourId);
      else
        conflict.push({
          ourId: sor.ourId,
          mappedMedusaId: aSorunk,
          medusaIdCarryingOurId: aMedusaban,
        });
      continue;
    }

    if (aMedusaban) {
      mapOnly.push({ ourId: sor.ourId, medusaId: aMedusaban });
      continue;
    }

    if (aSorunk) staleMapping.push(sor.ourId);
    create.push({
      ourId: sor.ourId,
      title: categoryTitle(
        sor.name,
        sor.parentOurId ? (nevek.get(sor.parentOurId) ?? null) : null,
      ),
      parentOurId: sor.parentOurId,
    });
  }
  return { create, skip, mapOnly, staleMapping, conflict };
}
