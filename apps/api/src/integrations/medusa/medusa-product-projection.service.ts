import { Injectable } from "@nestjs/common";

import {
  describeMedusaFailure,
  type MedusaAdminClient,
  type MedusaProductRow,
  type MedusaSalesChannelRow,
} from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  decidePublication,
  PUBLICATION_REASON_TEXT,
  type ProductPublicationState,
  type PublicationDecision,
} from "./medusa-publication.policy.js";

/**
 * Egy termék vetítése az Acropora OS-ből a Medusába.
 *
 * A kör egyetlen kérdése nem az, hogy MELY MEZŐK mennek át, hanem hogy a
 * futtatás MEGISMÉTELHETŐ-e. Ezért a szolgáltatás magja a döntés, nem az írás.
 */

import { medusaHandleFromSlug } from "./medusa-product-handle.js";
import { buildProductDescription } from "./product-description.js";

export interface ProjectableProduct {
  id: string;
  name: string;
  /** A ROVID leiras (a mai `Product.description`). */
  description: string | null;
  /**
   * A HOSSZU leiras, vagy `null`.
   *
   * KULON MEZO, MERT A MAI BOLT IS KET HELYEN MUTATJA a ket szoveget, es ahol
   * mind a ketto letezik, a ROVID all elobb a lapon. A ketto nem valtozata
   * egymasnak: merve a publikalt termekeken, 972-nek CSAK rovid es 105-nek CSAK
   * hosszu leirasa van, tehat barmelyiket valasztanank egyedul, a masik halmaz
   * lapjai URESEN erkeznenek meg.
   */
  descriptionLong: string | null;
  /**
   * A vetítendő változat cikkszáma, vagy `null`, ha nincs.
   *
   * A HÍVÓ SZERZŐDÉSE, és ki van írva, mert az adatbázisban a `sku` oszlop NEM
   * nullázható (`sku String @unique`). Vagyis a `null` itt sosem azt jelenti,
   * hogy „van változat, de nincs cikkszáma" - azt jelenti, hogy a hívó nem
   * TALÁLT olyan változatot, amit átvinne. A parancssori felület az AKTÍV
   * változatok közül veszi az elsőt.
   */
  primarySku: string | null;
  /**
   * A publikációs döntés BEMENETE, nem a döntés.
   *
   * Szándékosan az állapot utazik és nem a kész döntés: így a szabályt a
   * szolgáltatás alkalmazza, és a hívó nem tudja kihagyni. Egy parancssori
   * felület, ami maga döntene, egy nap másképp döntene.
   */
  publication: ProductPublicationState;
  /**
   * A termek kategoriai MEDUSA azonositokkal, vagy `null`.
   *
   * A `null` NEM azt jelenti, hogy a termeknek nincs kategoriaja. Azt jelenti,
   * hogy a hivo NEM TUD teljes listat adni -- vagy mert a termeknek tenyleg
   * nincs egy sem, vagy mert van, de valamelyik meg nincs lekepezve a
   * Medusara. A ket eset kovetkezmenye ELLENTETES a jelentesben (az egyik
   * rendben van, a masik hianyt jelez), de a KERES torzsere nezve ugyanaz: a
   * mezo nem megy ki.
   *
   * A megkulonboztetes ezert a HIVONAL lakik, ahol az adat is van. Ide mar
   * csak a dontes erkezik: van teljes lista, vagy nincs.
   */
  medusaCategoryIds: string[] | null;
  /**
   * A MARKA MEDUSA-OLDALI GYUJTEMENY-AZONOSITOJA, vagy `null`.
   *
   * A `null` HAROM allapotot fed le a hivo oldalan (nincs markaja; van, de
   * nincs lekepezve; nincs bekapcsolva), es a kulonbseg ITT mar nem
   * visszafejtheto -- ugyanugy, mint a `medusaCategoryIds` eseteben. A
   * megkulonboztetes ezert a HIVONAL lakik, ahol az adat is van; ide csak a
   * dontes erkezik. A szabaly: `medusa-brand.policy.ts`.
   */
  medusaCollectionId: string | null;
  /**
   * A MAI BOLTI CIM (a UNAS SefUrl-je), vagy `null`, ha nincs.
   *
   * A `null` NEM azt jelenti, hogy a termeknek ne lenne cime a boltban: azt,
   * hogy a hivo nem tud MAI cimet adni. A ket eset kovetkezmenye ellentetes --
   * ha nem kuldunk `handle`-t, a Medusa a NEVBOL szarmaztat egyet --, es a
   * megkulonboztetes ezert a hivonal lakik, ahol az adat is van.
   *
   * MIERT SZAMIT: merve az 1893 termeken (2026-09-03), a nevbol szarmaztatott
   * alak a mai SefUrl-lel mindossze NEGY esetben egyezne beture. A tobbi 1809
   * termek uj cimet kapna a boltban, es a regi hivatkozasok sehova nem
   * vezetnenek.
   */
  slug: string | null;
  /**
   * AZ INDEXELESI TILTAS, VAGY `null`.
   *
   * EZ AZ EGYETLEN SEO-TETEL, AMINEK ONALLO TETJE VAN, es a szam mondja meg,
   * miert: az 1893 termekbol MINDOSSZE KETTONEK van kezzel irt Meta blokkja, es
   * mindkettonel CSAK a `Robots` mezo all benne, `noindex, nofollow` ertekkel.
   * A tobbi 1891 `AutomaticMeta`, amit a UNAS a nevbol general -- azt a bolt is
   * tudna.
   *
   * VAGYIS AZ AT NEM VITEL ITT NEM VESZTESEG, HANEM A TILTAS ELTUNESE: az a ket
   * termek a boltban indexelhetove valna. Nem SEO-szoveg, hanem egy DONTES,
   * amit valaki meghozott, es amit csendben visszavonnank.
   */
  seoRobots: string | null;
  /**
   * A TERMEK KEPEI, MAR SORRENDBEN, vagy `null`.
   *
   * A LISTA SORRENDJE MAGA AZ ADAT: az ELSO elem a fo kep, a tobbi utana a
   * megadott sorrendben. A cel oldalon ugyanez az alak all -- a rang a tomb
   * indexebol keletkezik --, tehat itt sincs kulon rang-mezo.
   *
   * A `null` NEM azt jelenti, hogy a termeknek nincs kepe. Azt jelenti, hogy a
   * HIVO nem tud listat adni. A ket eset kovetkezmenye a keres torzsere nezve
   * ugyanaz (a mezo nem megy ki), de a jelentesben ELLENTETES, es ezert a
   * megkulonboztetes a hivonal lakik, ahol az adat is van -- ugyanugy, mint a
   * kategoriaknal es a bolti cimnel.
   *
   * MIERT NEM MEGY KI SOSEM URES TOMB: az `images` a cel oldalon az
   * update-agon CSERE-szemantikaju, tehat az ures lista LETOROLNE a termek
   * meglevo kepeit -- csendben, mert a hivas sikerrel terne vissza. Merve a
   * mai adaton: 1893 termekbol 88-nak nincs egyetlen kepe sem, tehat ez nem
   * elmeleti eset.
   *
   * AMI NEM UTAZIK VELE: az ALT SZOVEG. A cel oldali HTTP-ut a kepobjektumban
   * kizarolag `url`-t fogad, minden mas kulcsot csendben eldob. Ezert a lista
   * szandekosan URL-eket hordoz, nem objektumokat: egy `alt` mezo itt azt
   * igerne, hogy atmegy.
   */
  images: string[] | null;
}

export type ProjectionOutcome =
  /** Nem volt odaát, létrehoztuk, és rögzítettük a leképezést. */
  | {
      action: "created";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Volt leképezés, a meglévő terméket módosítottuk. */
  | {
      action: "updated";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Nem volt leképezés, de a külső azonosító megtalálta az ÉLŐ terméket. */
  | {
      action: "relinked";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Nem lehet folytatni, és megmondjuk, miért. */
  | { action: "stopped"; reason: ProjectionStopReason; details: string };

/** Amit a jelentés a publikációs oldalról kiír. */
export interface ProjectionPublicationReport {
  status: PublicationDecision["status"];
  salesChannel: PublicationDecision["salesChannel"];
  reason: string;
  /**
   * Melyik csatornára írtunk, és mi a NEVE.
   *
   * Kiírjuk, nem állítjuk. Egy rossz, de létező azonosítót az vesz észre, aki
   * a jelentést olvassa - és nem egy ellenőrzés, ami egy jogos átnevezésre is
   * pirosodna.
   */
  salesChannelName: string;
}

export type ProjectionStopReason =
  /**
   * A külső azonosító csak PUHÁN TÖRÖLT terméke(ke)n ül: MEGSZAKADT AZONOSSÁGI
   * LÁNC. Lásd az indoklást a `project` törzsében.
   */
  | "broken-identity-chain"
  /** Több ÉLŐ termék viseli ugyanazt a külső azonosítót. */
  | "ambiguous"
  /**
   * A hívó nem adott átvihető cikkszámot, tehát nincs mit változatként
   * átvinni.
   *
   * A NEVE SZÁNDÉKOSAN NEM „nincs cikkszáma": a `sku` oszlop nem nullázható,
   * tehát a termékNEK lehet cikkszáma - csak nem olyan változaton, amit a
   * hívó átvinne. A pontos okot az tudja, aki a lekérdezést futtatta; a
   * szolgáltatás csak azt tudja, hogy nem kapott értéket, és csak ezt is
   * állítja.
   */
  | "no-sku"
  /**
   * A keresés kimerítette a limitet, tehát lehet több találat is. Csonkolt
   * halmazon nem döntünk: az élők száma ilyenkor nem megbízható.
   */
  | "lookup-truncated"
  /**
   * Nincs beállítva a storefront csatorna azonosítója.
   *
   * MEGÁLLUNK, és nem "óvatoskodunk". A csatorna-kötésnek három alakja van, és
   * kettő közülük kívülről egyformán néz ki: ha a mezőt elhagynánk, a linkek
   * érintetlenül maradnának, miközben a status átáll - félkész állapot. Ha
   * üres listát küldenénk, az egy LEKÖTÉS, amit egy hét múlva senki nem tud
   * megkülönböztetni egy szándékos döntéstől. Mindkét óvatos alak rosszabb a
   * hibánál.
   */
  | "sales-channel-not-configured"
  /**
   * A beállított csatorna azonosítója nem létezik a cél oldalon.
   *
   * Ez az az eset, amit egy környezetből a másikba átörökölt beállítás
   * okoz. Az ELSŐ használatkor derül ki, egyszer, nem minden hívásnál - és
   * ez a jó pillanat: egy termék, ami nem jelenik meg a boltban, sokkal
   * később és sokkal drágábban mondaná el ugyanezt.
   */
  | "sales-channel-not-found"
  /**
   * EGY OLVASÓ Medusa-hívás elhasalt.
   *
   * Külön áll az írástól, és ez a legfontosabb különbség a kettő között: egy
   * olvasás bukásánál BIZTOSAN nem változott semmi odaát, egy írásénál nem
   * tudjuk. A jelentést olvasónak ez a legelső kérdése, tehát a NÉV mondja
   * meg, ne a szöveg.
   */
  | "medusa-read-failed"
  /**
   * EGY ÍRÓ Medusa-hívás elhasalt.
   *
   * A hívás elindult, tehát a cél oldali állapotot NEM tudjuk. Ilyenkor a
   * leképezést sem írjuk: egy leképezés azt állítaná, hogy a termék odaát a
   * mi azonosítónkon áll, holott épp ez az, ami bizonytalan.
   */
  | "medusa-write-failed";

/**
 * MIÉRT nincs átvihető cikkszám - és a szolgáltatás EZT MEG TUDJA MONDANI.
 *
 * Az első változatom azt írta, hogy „a terméknek nincs cikkszáma". Ezt innen
 * nem lehet tudni, és ráadásul NEM IGAZ: az adatbázisban a `sku` oszlop nem
 * nullázható (`sku String @unique`), tehát a termékNEK lehet cikkszáma. A
 * mondat egy olyan állapotot nevezett meg, ami elő sem állhat, és a teendőre is
 * rosszul mutatott: cikkszámot kerestetett, ahelyett hogy változatot
 * aktiváltatna.
 *
 * A PONTOS OK VISZONT ITT VAN, plumbing nélkül: az `activeVariantCount` már
 * megérkezik a publikációs bemenetben, ugyanabból a lekérdezésből. A két mező
 * együtt eldönti, melyik eset áll fenn - és a MÁSODIK eset (aktív változat van,
 * cikkszám mégsem jött) a hívó szerződésszegése, amit szintén meg kell
 * nevezni, nem elhallgatni.
 */
function describeMissingSku(product: ProjectableProduct): string {
  if (product.publication.activeVariantCount === 0)
    return (
      `${product.id}: nincs AKTÍV változata, ezért nincs átvihető cikkszám. ` +
      `Ez NEM cikkszám-hiány: a mező nem nullázható, tehát a terméknek lehet ` +
      `inaktív változata cikkszámmal. A teendő egy változat aktiválása.`
    );

  return (
    `${product.id}: a hívó ${product.publication.activeVariantCount} aktív ` +
    `változatot jelzett, elsődleges cikkszámot mégsem adott. Ez ellentmondó ` +
    `bemenet, nem termék-állapot: a hívót kell megnézni.`
  );
}

/**
 * Az egyetlen opció, amit a Medusa megkövetel.
 *
 * A séma szerint csak a cím kötelező, a MUNKAFOLYAMAT viszont megtagadja az
 * opció nélküli terméket. Egy egyváltozatos terméknek is kell legalább egy
 * opció, tehát adunk neki egyet. Ez nem üzleti fogalom, hanem a cél oldali
 * modell kötelező eleme, és a neve is ezt mondja.
 */
const DEFAULT_OPTION_TITLE = "Kivitel";
const DEFAULT_OPTION_VALUE = "Alap";

@Injectable()
export class MedusaProductProjectionService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
    /**
     * A storefront csatorna azonosítója, vagy `null`, ha nincs beállítva.
     *
     * Konstruktor-paraméter és nem futásidejű környezet-olvasás, hogy a
     * "hiányzó beállításnál megállunk" tulajdonság hálózat nélkül mérhető
     * legyen.
     */
    private readonly storefrontSalesChannelId: string | null,
  ) {}

  /** Az első használatkor kérdezzük le, utána a folyamat élettartamára tartjuk. */
  private resolvedChannel: MedusaSalesChannelRow | null | undefined;

  private async resolveSalesChannel(): Promise<MedusaSalesChannelRow | null> {
    if (this.resolvedChannel !== undefined) return this.resolvedChannel;
    this.resolvedChannel = await this.medusa.findSalesChannel(
      this.storefrontSalesChannelId!,
    );
    return this.resolvedChannel;
  }

  async project(
    product: ProjectableProduct,
    now: Date,
  ): Promise<ProjectionOutcome> {
    if (!product.primarySku)
      return {
        action: "stopped",
        reason: "no-sku",
        details: describeMissingSku(product),
      };

    if (!this.storefrontSalesChannelId)
      return {
        action: "stopped",
        reason: "sales-channel-not-configured",
        details:
          `${product.id}: nincs beállítva a storefront csatorna azonosítója. ` +
          `Nem küldtünk semmit: sem státuszt, sem csatorna-műveletet. ` +
          `A csatorna elhagyása félkész állapotot hagyna, az üres lista pedig ` +
          `lekötésnek látszana, és egyik sem különböztethető meg utólag egy ` +
          `szándékos döntéstől.`,
      };

    /**
     * A csatorna LÉTEZÉSE egyszer, az első használatkor.
     *
     * Nem minden hívásnál: az azonosító nem változik futás közben. Az első
     * használat viszont a legkorábbi pillanat, amikor egy átörökölt vagy
     * elgépelt beállítás kiderülhet.
     */
    let channel: MedusaSalesChannelRow | null;
    try {
      channel = await this.resolveSalesChannel();
    } catch (error) {
      return {
        action: "stopped",
        reason: "medusa-read-failed",
        details:
          `${product.id}: a storefront csatorna lekérdezése elhasalt ` +
          `(${describeMedusaFailure(error)}). Nem írtunk semmit.`,
      };
    }
    if (!channel)
      return {
        action: "stopped",
        reason: "sales-channel-not-found",
        details:
          `${product.id}: a beállított storefront csatorna ` +
          `(${this.storefrontSalesChannelId}) nem létezik a cél oldalon. ` +
          `A csatorna azonosítója KÖRNYEZETENKÉNTI érték: a stage azonosítója ` +
          `az élesen nem létezik. Nem küldtünk semmit.`,
      };

    const publication = decidePublication(product.publication);
    /**
     * Amit a jelentés kiír. A brief 11. tesztje ezt követeli: a felület
     * mondja meg, publikáció és csatorna szinten MIT változtatott. Egy
     * "kész" sor önmagában nem mondja meg, mi lett a termékkel.
     */
    const report: ProjectionPublicationReport = {
      status: publication.status,
      salesChannel: publication.salesChannel,
      reason: PUBLICATION_REASON_TEXT[publication.reason],
      salesChannelName: channel.name,
    };
    const salesChannels =
      publication.salesChannel === "attach"
        ? [{ id: this.storefrontSalesChannelId }]
        : [];

    /**
     * A MEZO CSAK AKKOR KERUL A TORZSBE, HA VAN MIT KULDENI.
     *
     * Ures tombot SOHA nem kuldunk: ha a `categories` csere-szemantikaju (a
     * `sales_channels` bizonyitottan az), az ures lista TOROLNE a termek
     * besorolasat -- csendben, mert a hivas sikerrel terne vissza.
     */
    const categoryPatch =
      product.medusaCategoryIds && product.medusaCategoryIds.length > 0
        ? { categories: product.medusaCategoryIds.map((id) => ({ id })) }
        : {};

    /**
     * A MARKA GYUJTEMENYE, ES A MEZO ELHAGYASA ITT IS DONTES.
     *
     * Ugyanaz az alak, mint a kategoriaknal, es ugyanabbol az okbol: a
     * `collection_id: null` LEVENNE a termekrol azt a gyujtemenyt, amit a bolt
     * oldalan barki mas oda tett. A vetites nem a marka gazdaja, tehat amit nem
     * tudunk megnevezni, ahhoz nem is nyulunk.
     */
    const collectionPatch = product.medusaCollectionId
      ? { collection_id: product.medusaCollectionId }
      : {};

    /**
     * A `handle` MEZO ELHAGYASA ES AZ URES ERTEK NEM UGYANAZ, ugyanugy, mint a
     * kategoriaknal -- csak itt a kulonbseg MERT, nem felteves.
     *
     * Ha a mezot elhagyjuk, a Medusa a NEVBOL szarmaztat handle-t
     * (`productCategory.handle ??= kebabCase(name)` a kategoriaknal merve, a
     * termeknel ugyanez a minta). Ha URESET kuldenenk, azt vagy elutasitana,
     * vagy felulirna a mar meglevo cimet -- mindket eset rosszabb, mint ha a
     * mezo nem megy ki.
     *
     * Ezert a `medusaHandleFromSlug` `null`-t ad, ha nincs mit atvinni, es a
     * mezo ilyenkor KI SEM KERUL a kerésbe.
     */
    const handle = medusaHandleFromSlug(product.slug);
    const handlePatch = handle ? { handle } : {};

    /**
     * A `metadata` MEZOBE MEGY, MERT A MEDUSANAK NINCS SAJAT SEO-MEZOJE.
     *
     * Merve a telepitett 2.19.0 tipusdefiniciojan (acrobot, 2026-09-03): a
     * `CreateProductDTO` ismer `thumbnail`, `images`, `handle` es `metadata`
     * mezot -- SEO-mezot nem. A `metadata` tehat nem kenyelmi valasztas, hanem
     * az egyetlen hely, ahol ez az ertek atmehet.
     *
     * A KULCS `snake_case`, a Medusa sajat konvencioja szerint. Es a mezo
     * ELMARAD, ha nincs ertek: egy ures `metadata` felulirna, amit a bolt
     * oldalan barki mas oda tett.
     */
    /**
     * A KET LEIRAS OSSZERAKASA, ES A METAADAT MINDKETTOT VISZI.
     *
     * A cel oldalon EGY leiras-mezo van, a mai bolt viszont KET helyen mutatja
     * a ket szoveget. Ezert a fo mezobe osszefuzve mennek (rovid elol, ahogy a
     * lapon allnak), a metaadatba pedig KULON is -- hogy a kirakat ket slotba
     * tudja tenni oket, ahogy a mai bolt teszi.
     *
     * A KIVETEL: ha az egyik szoveg tartalmazza a masikat, csak a tartalmazo
     * megy a fo mezobe. Merve a publikalt termekeken: 79 ilyen eset van a 181
     * ket-mezosbol, es a TOBBSEG a forditott irany (66-nal a HOSSZU van benne a
     * ROVIDBEN). Egy egyiranyu vizsgalat 66 lapon hagyna ott a duplikatumot.
     */
    const descriptions = buildProductDescription(
      product.description,
      product.descriptionLong,
    );

    const metadataPatch =
      product.seoRobots || Object.keys(descriptions.metadata).length > 0
        ? {
            metadata: {
              ...(product.seoRobots ? { seo_robots: product.seoRobots } : {}),
              ...descriptions.metadata,
            },
          }
        : {};

    /**
     * A KEPEK ES A FO KEP EGYUTT MENNEK, ES A THUMBNAIL MINDIG KIIRODIK.
     *
     * A ket mezot azert epiti egy helyen ez a foltocska, mert egyutt igazak:
     * a fo kep a lista ELSO eleme, es ha a lista nem megy ki, a thumbnailnek
     * sincs mire mutatnia.
     *
     * A THUMBNAIL NEM HAGYHATO EL, ES EZ MERT KULONBSEG A KET AG KOZOTT: a
     * create-ag normalizaloja visszaesik az `images[0].url` ertekere, ha a mezo
     * hianyzik; az UPDATE-agon viszont nincs ilyen visszaeses, ott a REGI ertek
     * maradna. Egy megvaltozott fo kep tehat a masodik futastol csendben nem
     * erne at -- es a vetites eppen a masodik futastol update-el.
     *
     * URES LISTA SOSEM MEGY: sem a `null`, sem az ures tomb nem kerul a
     * torzsbe, mert az update-agon a mezo csere-szemantikaju, es az ures lista
     * letorolne a termek meglevo kepeit.
     */
    const imagePatch =
      product.images && product.images.length > 0
        ? {
            images: product.images.map((url) => ({ url })),
            thumbnail: product.images[0],
          }
        : {};

    const existingLink = await this.links.findByProductId(product.id);
    if (existingLink) {
      /**
       * A státusz és a csatorna EGY kérésben megy, és ez nem tömörítés.
       * Két kérésben lenne egy pillanat, amikor az egyik már átállt, a másik
       * még nem - és a storefront a KETTŐ metszetét nézi, tehát a félkész
       * állapot pont úgy néz ki, mint egy sikeres váltás.
       */
      try {
        await this.medusa.update(existingLink.medusaProductId, {
          title: product.name,
          description: descriptions.description,
          external_id: product.id,
          ...handlePatch,
          ...metadataPatch,
          ...imagePatch,
          status: publication.status,
          sales_channels: salesChannels,
          ...categoryPatch,
          ...collectionPatch,
        });
      } catch (error) {
        return {
          action: "stopped",
          reason: "medusa-write-failed",
          details:
            `${product.id}: a meglévő Medusa-termék ` +
            `(${existingLink.medusaProductId}) módosítása elhasalt ` +
            `(${describeMedusaFailure(error)}). A cél oldali állapot ` +
            `BIZONYTALAN, ezért a leképezést sem frissítettük.`,
        };
      }
      await this.links.link(product.id, existingLink.medusaProductId, now);
      return {
        action: "updated",
        medusaProductId: existingLink.medusaProductId,
        publication: report,
      };
    }

    /**
     * Nincs leképezés. Ez NEM hibaállapot: az első éles betöltés normál
     * állapota. Mielőtt bármit létrehoznánk, meg kell nézni, nem áll-e már
     * odaát a mi külső azonosítónk - különben egy elveszett leképezés minden
     * futásnál új terméket szülne.
     */
    let found: Awaited<ReturnType<MedusaAdminClient["findByExternalId"]>>;
    try {
      found = await this.medusa.findByExternalId(product.id);
    } catch (error) {
      return {
        action: "stopped",
        reason: "medusa-read-failed",
        details:
          `${product.id}: a külső azonosítós keresés elhasalt ` +
          `(${describeMedusaFailure(error)}). Nem írtunk semmit, és nem is ` +
          `hoztunk létre terméket: egy sikertelen keresésből NEM következik, ` +
          `hogy a termék nincs odaát.`,
      };
    }

    /**
     * Csonkolt válaszon NEM döntünk. A lista nem rendez, tehát egy kimerített
     * limit nem „az elsőket" adja vissza, hanem tetszőleges részhalmazt - és
     * abból az élők száma bármi lehet. Ez a megállás olcsóbb, mint egy
     * magabiztos rossz ág.
     */
    if (found.truncated)
      return {
        action: "stopped",
        reason: "lookup-truncated",
        details:
          `${product.id}: a keresés kimerítette a limitet (${found.rows.length} sor), ` +
          `tehát lehet több találat is. Csonkolt halmazon nem döntünk.`,
      };

    const live = found.rows.filter((row) => !row.deleted_at);
    const deleted = found.rows.filter((row) => row.deleted_at);

    /**
     * A SZÁMLÁLÁS AZ ÉLŐKRE MEGY, nem a nyers sorokra. Egy törölt és egy élő
     * termék ugyanazzal a külső azonosítóval hétköznapi állapot: pont az áll
     * elő, ha valamit törölnek és ugyanaz az azonosító újra bekerül. Ilyenkor
     * az élő számít, a törölt sor történelem.
     */
    if (live.length >= 2)
      return {
        action: "stopped",
        reason: "ambiguous",
        details: `${product.id}: több élő Medusa-termék viseli ugyanezt az azonosítót: ${live
          .map((row) => row.id)
          .join(", ")}`,
      };

    if (live.length === 1) {
      const medusaProductId = live[0]!.id;
      await this.links.link(product.id, medusaProductId, now);
      return { action: "relinked", medusaProductId, publication: report };
    }

    /**
     * Csak törölt találat: MEGÁLLUNK, és jelentjük.
     *
     * Balázs döntése, 2026-08-24, szó szerint: „Törölt Medusa rekord plusz
     * nincs élő találat esetén a projection álljon meg ennél a terméknél és
     * jelentse az identity conflictot. Nem hozunk létre újat automatikusan.
     * Nem próbálunk restore-t. Nem skipeljük csendben. Az ok: ez nem ownership
     * konfliktus, hanem MEGSZAKADT AZONOSSÁGI LÁNC."
     *
     * A különbség nem szószépítés. Egy tulajdon-konfliktusnál KÉT JOGOS IGÉNY
     * áll szemben, és dönteni kell közöttük. Itt a láncnak az egyik VÉGE
     * hiányzik: tudjuk, melyik a mi termékünk, és tudjuk, hogy az azonosítója
     * egy eltemetett soron ül, de azt nem tudjuk, mi történt közben. Bármelyik
     * automatikus válasz találgatás lenne.
     *
     * A másik két út egyébként sem járható: létrehozni tilos, mert akkor két
     * termék viselné ugyanazt a külső azonosítót, és ezt a Medusa nem
     * akadályozza meg (nincs egyedi index a mezőn); visszaállítani pedig nem
     * lehet, mert az admin API-n NINCS ilyen művelet.
     */
    if (deleted.length > 0)
      return {
        action: "stopped",
        reason: "broken-identity-chain",
        details:
          `Megszakadt azonossági lánc. Acropora OS termék: ${product.id} ` +
          `(ez egyben a Medusának küldött külső azonosító is). ` +
          `Odaát csak TÖRÖLT termék viseli ezt az azonosítót: ` +
          `${deleted.map((row) => row.id).join(", ")}. ` +
          `Nem hoztunk létre újat és nem állítottunk vissza semmit: ` +
          `ember döntése, hogy a törölt sor sorsa mi legyen.`,
      };

    let created: MedusaProductRow;
    try {
      created = await this.medusa.create({
        title: product.name,
        description: descriptions.description,
        external_id: product.id,
        ...handlePatch,
        ...metadataPatch,
        ...imagePatch,
        status: publication.status,
        sales_channels: salesChannels,
        ...categoryPatch,
        ...collectionPatch,
        options: [
          { title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] },
        ],
        variants: [
          {
            title: product.name,
            sku: product.primarySku,
            options: { [DEFAULT_OPTION_TITLE]: DEFAULT_OPTION_VALUE },
            /**
             * ÜRESEN, és ez állítás, nem mulasztás: nem viszünk át árat. A
             * mező azért van itt, mert a Medusa megköveteli; a tartalma azért
             * üres, mert az árazás nem ennek a körnek a dolga.
             */
            prices: [],
          },
        ],
      });
    } catch (error) {
      return {
        action: "stopped",
        reason: "medusa-write-failed",
        details:
          `${product.id}: a termék létrehozása elhasalt ` +
          `(${describeMedusaFailure(error)}). A cél oldali állapot ` +
          `BIZONYTALAN: a létrehozás elindult, tehát lehet, hogy a ` +
          `termék megszületett. Leképezést NEM írtunk, így a ` +
          `következő futás újra megkeresi a külső azonosítót.`,
      };
    }
    await this.links.link(product.id, created.id, now);
    return {
      action: "created",
      medusaProductId: created.id,
      publication: report,
    };
  }
}

/** Csak a teszteknek, hogy a sor alakja egy helyen legyen leírva. */
export type { MedusaProductRow };
