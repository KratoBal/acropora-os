import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AssetListQueryDto,
  AssetLabelBatchQueryDto,
  AssetOwnersQueryDto,
  FreeAssetLabelsQueryDto,
  IssueAssetLabelBatchDto,
  IssueAssetLabelsDto,
  CreateAssetDto,
  UpdateAssetDto,
  UpdateAssetDocumentCaptionDto,
  UploadAssetDocumentDto,
} from "./dto/asset.dto.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * Hány fájl mehet egy feltöltési kérésben. A fájlok a memóriában gyűlnek, így
 * a legrosszabb eset ennek és a 10 megabájtos fájlméretnek a szorzata.
 */

@Controller("service/assets")
export class ServiceAssetsController {
  constructor(private readonly service: ServiceAssetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: AssetListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, user);
  }

  /**
   * A DOKUMENTUM-TAROLO ALLAPOTA, a telepites ellenorzesehez.
   *
   * === A KOMMENT KORABBAN A JOGRA HIVATKOZOTT, ES A JOG NEM VEDETT (e59a0608) ===
   *
   * Itt ez allt: "a `SERVICE_MANAGE` jog alatt all, es NEM publikus". A masodik
   * fele HAMIS volt, es a lanc minden szeme merve, a mai fo agon (7cd51874):
   *
   *   1. `PARTNER_SERVICE` VISELI a `SERVICE_MANAGE` jogot
   *      (`packages/types/src/auth.ts:388`)
   *   2. a `PermissionGuard` JOGOT nez, hatokort nem
   *   3. ez a handler a KEROT MEG SEM KAPTA, tehat szerkezetileg nem is tudott
   *      hatokort szukiteni -- a harom kontroller harminc partner-jog alatti
   *      utvonalabol EZ AZ EGY volt ilyen
   *
   * KONTROLL, hogy az ut nem elmeleti: ugyanezen a kontrolleren a `list`, a
   * `detail` es a `scan` MAR `partnerScopeOf(user)`-rel megy -- vagyis
   * partner-kerok bizonyitottan eljutnak ide.
   *
   * === MIT ADOTT VOLNA KI, ES MIERT IDO-FUGGO A SULYA ===
   *
   * A valasz `reason` mezoje a tarolo GYOKERENEK ABSZOLUT UTVONALAT viszi
   * (`filesystem-document-store.ts`: "A tarolo gyokere nem letezik: ${root}",
   * "A jelolo fajl hianyzik ... ${root}/${MARKER}", "nem irhato: ${root}").
   *
   * === ES ITT KORABBAN AZ ALLT, HOGY A TAROLO MA KI VAN KAPCSOLVA. NEM
   * BIZONYITOTT (acrobot merese, 2026-09-22 03:5x, HELYESBITES) ===
   *
   * Amit EN mertem, az KET REPO-OLDALI allitas volt: a
   * `docs/DOCUMENT-STORE-DEPLOYMENT.md` kimondja, hogy a kapcsolo sehol nincs
   * beallitva, es a ket env-sablonban tenyleg uresen all. Ebbol azt irtam ide,
   * hogy a valasz MA a `not-enabled` agra esik.
   *
   * ACROBOT AZ ELES OLDALT MERTE, ES AZ MAST MOND: a `DOCUMENT_STORE_ROOT`
   * kulcs MIND A KET GEPEN BE VAN JEGYEZVE --
   *
   *     ELES        `acropora-api`
   *     AI/STAGING  `acropora-stage-api`
   *
   * -- gepenkent KET bejegyzessel (egy normal, egy preview), mindegyik
   * 2026-09-02 09:48:39-kor letrehozva, `is_buildtime=true` ES
   * `is_runtime=true`. Vagyis valaki szandekosan vette fel, es a FUTO
   * konteneri kornyezetbe is beleszol.
   *
   * Az ERTEKET viszont sem a Coolify API, sem a repo nem mutatja meg -- es a
   * `None` valasz NEM bizonyitek a hianyra: KONTROLL, hogy ugyanaz az API a
   * `NODE_ENV`-re es a `PORT`-ra is `None`-t ad, pedig azok bizonyosan be
   * vannak allitva. A masik ut sem jarhato: a `docker` parancs ebbol a
   * kontenerbol nem letezik. Ez a meres HATARA, es igy all 2026-09-22-en.
   *
   * VAGYIS A `not-enabled` AG MA NEM BIZONYITOTT, csak a SABLON uressege az --
   * es a ketto nem ugyanaz a kerdes. Egy repo-oldali sablon nem mondja meg, mi
   * all a futo alkalmazas kornyezeteben; epp ez az a csapda, amiert a Prisma
   * `DATABASE_URL`-je is a FOLYAMAT kornyezetebol jon, nem a repo `.env`-jebol.
   *
   * AMI EBBOL KOVETKEZIK, ES AZ IRANYT NEM VALTOZTATJA, CSAK A SULYAT: nem az
   * all, hogy "ma olcso es kesobb kenyelmetlen", hanem hogy a szivargas LEHET,
   * HOGY MAR MOST FENNALL. AMELY NAPON a kotet bekapcsol (vagy amely napon
   * kiderul, hogy mar be van), ugyanez a vegpont a konteneri utvonalakat es a
   * csatolas allapotat adja ki.
   *
   * ES AMIERT EZ A BEKEZDES AT VAN IRVA, NEM KIEGESZITVE: egy komment, ami egy
   * NEM BIZONYITOTT allapotot tenykent mond ki, ugyanaz a fajta, mint amit ez
   * a fejlec fentebb epp felro a jogra hivatkozo mondatnak. A hedge ("a doksi
   * allitja") ott allt a zarojelben, a MONDAT viszont erosebb volt nala.
   *
   * === MIERT ELUTASITAS, ES NEM HATOKOR-SZURES -- HOLOTT EZ OLVASO UT ===
   *
   * Az olvaso utakon rendszerint a szukites a helyes javitas: a partner a SAJAT
   * hatokorebe eso jegyet es eszkozt JOGOSAN olvassa. ITT VISZONT NINCS
   * partner-hatokoru valtozata annak, hogy a MI kotetunk csatolva van-e -- a
   * valasz nem egy szurheto halmaz, hanem egy uzemeltetesi teny a szerverrol.
   * Szurni tehat nincs mit; a kerdes csak az, hogy latja-e vagy nem.
   *
   * ES A B MA SEMMIT NEM VESZ EL: lemertem, hogy EGYETLEN kliens sem hivja
   * (web, partner, mobil: nulla hivas; a mobil egyetlen talalata egy komment,
   * ami a szerver fajlnevere hivatkozik). Az elutasitas kesobb barmikor
   * tagithato; a szukites ma dontene el egy kerdest, amit senki nem tett fel.
   *
   * === MIERT NEM A `requireInternalWriter` ===
   *
   * A mechanizmusa ugyanez, de a NEVE irasi lepest mond, ez pedig olvaso ut --
   * es a `worksheets` modulban all. Az atnevezese es athelyezese onallo lepes
   * (nyolc hivohely), tehat kulon korbe tartozik, nem egy biztonsagi javitas
   * kozepere. A szabaly forrasa igy is EGY: a `partnerScopeOf`.
   *
   * A VALASZ MINDIG 200, meg `broken` allapotnal is. Ez szandekos: aki ezt
   * hivja, epp azt akarja MEGTUDNI, mi az allapot -- egy 503 ugyanazt az
   * informaciot rejtene el, amiert a vegpont keszult.
   */
  @Get("document-store")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async documentStoreStatus(@CurrentUser() user: AuthenticatedUser) {
    if (partnerScopeOf(user).kind !== "internal")
      throw new ForbiddenException(
        "A dokumentum-tároló állapotát csak belsős felhasználó nézheti meg.",
      );
    return this.service.documentStoreStatus();
  }

  /**
   * A SZABAD MATRICAK. SERVICE_MANAGE, NEM SERVICE_VIEW.
   *
   * A kiadott kodok listaja maga a keszlet: aki latja, az latja, mely kodok
   * leteznek. A matricakod gyenge (egy betu es negy szam), tehat ez a lista
   * pont az az adat, amibol egy vegigprobalas indulna. A SZERELO nem is ezt
   * hasznalja: o a matricat olvassa be, nem listat bongesz.
   */
  @Get("labels/free")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  freeLabels(@Query() query: FreeAssetLabelsQueryDto) {
    return this.service.freeLabels(query.limit ?? 100);
  }

  /**
   * ESZKOZ A BEOLVASOTT MATRICAKODROL.
   *
   * SERVICE_VIEW eleg, mint a `scan/:qrToken` vegpontnal -- DE ITT a tarolo
   * TULAJDONT IS ELLENORIZ. A ket ut jogosultsagi szintje azonos, a
   * lathatosaguk nem, es a kulonbseg oka a kod EROSSEGE: a qrToken 128 bites
   * veletlen, a matricakod ot karakter.
   */
  @Get("scan-label/:code")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  scanLabel(
    @Param("code") code: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.scanLabel(code, user);
  }

  /**
   * UJ MATRICA-TETEL GENERALASA. SERVICE_MANAGE.
   *
   * MUVELET, NEM LEKERDEZES: rekordot hoz letre, es a vegen KINYOMTATOTT
   * matrica lesz belole a fizikai vilagban. Ket gombnyomas ket tetelt csinal --
   * a lista percre pontos idopontja azert all ott, hogy ez AZONNAL latszodjon.
   */
  @Post("label-batches")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  issueLabelBatch(@Body() input: IssueAssetLabelBatchDto) {
    return this.service.issueBatch(input.count);
  }

  /**
   * MAR KINYOMTATOTT KODOK BETOLTESE UJ TETELKENT. SERVICE_MANAGE.
   *
   * Az elso tetel a nyilvantartasban eppen ilyen: a 2026-09-02-i tiz kod, amit
   * mar kinyomtattak. Megismetelheto: a mar letezo kodok nem duplikalodnak, es
   * a valasz megmondja, melyek voltak azok.
   */
  @Post("label-batches/import")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  importLabelBatch(@Body() input: IssueAssetLabelsDto) {
    return this.service.importBatch(input.codes);
  }

  /** A korabbi generalasok: mikor, hany kod, hany szabad meg. */
  @Get("label-batches")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  labelBatches(@Query() query: AssetLabelBatchQueryDto) {
    return this.service.labelBatches(query.limit ?? 50);
  }

  /**
   * EGY KOTEG KODJAI, A LETOLTESHEZ. SETTINGS_MANAGE, mint a listae.
   *
   * A KONKRET UT A `label-batches` ALATT ALL, es a `:id` szegmens utan jon a
   * `codes` -- igy nem nyeli el a lista utvonalat.
   */
  @Get("label-batches/:id/codes")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  labelBatchCodes(@Param("id") id: string) {
    return this.service.labelBatchCodes(id);
  }

  @Get("owners")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  owners(
    @Query() query: AssetOwnersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.owners(query, partnerScopeOf(user));
  }

  /**
   * A BEOLVASAS A HIVO LATHATOSAGAN BELUL MARAD -- ES EZ FELULIR EGY KORABBI
   * SPEC-DONTEST.
   *
   * AMI ITT ALLT 2026-09-22-IG: "A TULAJDONOST SZANDEKOSAN NEM ELLENORIZZUK
   * (spec 4.1): a token maga a kulcs." Ez a mondat a PARTNER-hatokorre
   * MOSTANTOL NEM all.
   *
   * AKI FELULIRTA, ES MIKOR: Balazs, 2026-09-22 08:55:25 UTC (Discord, uzenet
   * 1551879584851431436), szo szerint: "ne lassa". A kerdes, amire valaszolt
   * (uzenet 1551879397806448701): "Ha a partner embere odamegy egy olyan
   * helyszinre, ami nincs hozza rendelve, es beolvassa a gepen a QR kodot,
   * lassa az eszkozt vagy ne?"
   *
   * A valasz tehat PONTOSAN erre az utra szol, es nem tagabb annal.
   *
   * ES A REGI INDOK AMUGY IS PONTATLAN VOLT: a vegpont `SERVICE_VIEW` jog alatt
   * all es `@CurrentUser`-t vesz, tehat a token sosem volt "a kulcs", csak a
   * masodik tenyezo.
   *
   * A BELSOS HIVO VALTOZATLAN: ott a lathatosagi fuggveny ures szurot ad, tehat
   * a szerelonk beolvasasa barmelyik ott allo eszkozt megnyitja -- a 2026-08-21-i
   * dontes szerint. Ha ez valaha valtozik, ITT kell atirni, nem a taroloban.
   */
  @Get("scan/:qrToken")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  scan(
    @Param("qrToken") qrToken: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.scan(qrToken, user);
  }

  @Get(":id/qr")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  qrCode(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.qrCode(id, user);
  }

  /**
   * A CSATOLMÁNYOK LISTÁJA -- ÉS A MEGNÉZÉSHEZ `SERVICE_VIEW` ELÉG.
   *
   * NEM `SERVICE_MANAGE`, és ez átvett döntés, nem új: a hibajegy ugyanezen a
   * jogkörön adja ki a saját listáját, és a mobil munkalap-galéria kommentje
   * mondja ki az indokot (`worksheets/[id].tsx`): a galéria a manage-kapun
   * KÍVÜL áll, különben a szerelő feltölt, és nem látja, amit feltöltött.
   *
   * A letöltés (`:id/documents/:documentId`) már ma is `SERVICE_VIEW` alatt
   * áll, tehát ez a sor nem nyit új utat: azt a listát adja ki, amit ugyanez a
   * hívó az adatlapon (`GET :id`) amúgy is megkap.
   *
   * A DEKLARÁCIÓ A `@Get(":id")` FÖLÖTT ÁLL, ugyanúgy, mint a `:id/qr`.
   * Az útvonal-feloldást INNEN NEM TUDOM MEGMÉRNI (a csomagban nincs sem
   * `@nestjs/testing`, sem `supertest`, tehát futó alkalmazás kellene
   * hozzá), és egy két szegmensű GET eddig nem is állt a `:id` UTÁN ebben a
   * fájlban -- a `:id/documents/:documentId` három szegmensű. Ahol nem
   * tudok mérni, ott a fájl saját, működő sorrendjét követem.
   */
  @Get(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  documents(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.documents(id, user);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id, partnerScopeOf(user));
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id, user);
  }

  @Post(":id/qr/rotate")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  rotateQr(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.rotateQr(id, user.id, user);
  }

  /**
   * TÖBB FÁJL EGY KÉRÉSBEN, UGYANAZON A MEZŐNÉVEN.
   *
   * A mezőnév szándékosan maradt `file`: a webes felület ma egyetlen fájlt
   * küld ezen a néven, és egy átnevezés azt a hívót törte volna el, ami ma
   * működik. A `FilesInterceptor` ugyanazt a nevet több példányban is
   * elfogadja, tehát a régi hívó változatlanul megy, az új pedig többet küld.
   *
   * A DARABSZÁM KORLÁT NEM ÍZLÉS: a fájlok a memóriában gyűlnek
   * (`memoryStorage`), tehát egy kérés legrosszabb esete a darabszám és a
   * fájlméret szorzata. Tíz kép tíz megabájttal száz megabájt egyetlen
   * kérésben - ez a felső határ, amit egy telefon egy körben feltölthet.
   */
  @Post(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  @UseInterceptors(
    // EGGYEL TÖBBET ENGEDÜNK BE, MINT AMENNYIT ELFOGADUNK, és ez nem
    // pongyolaság. A multer a saját korlátját a stream szintjén vágja el, és a
    // hibáját semmi nem alakítja át: a hívó 500-at kapna, holott csak túl sok
    // fájlt jelölt ki. Egy fájllal több beolvasása legfeljebb tíz megabájt, és
    // cserébe a válasz megmondja, mi a baj és mi a határ.
    FilesInterceptor("file", DOCUMENT_UPLOAD_LIMITS.files + 1, {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  async uploadDocument(
    @Param("id") id: string,
    @Body() input: UploadAssetDocumentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!files?.length)
      throw new BadRequestException("A feltöltendő fájl kötelező.");
    if (files.length > DOCUMENT_UPLOAD_LIMITS.files)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${DOCUMENT_UPLOAD_LIMITS.files} fájl tölthető fel.`,
      );

    // EGYESÉVEL, SORBAN, ÉS NEM PÁRHUZAMOSAN. A keret-ellenőrzés a már
    // felhasznált helyet olvassa a táblából: párhuzamos írásoknál mindegyik
    // ugyanazt a régi összeget látná, és együtt átvinnék a határon úgy, hogy
    // külön-külön mindegyik belefért volna.
    const created = [];
    for (const file of files) {
      created.push(
        await this.service.addDocument(
          id,
          input.type,
          file,
          user.id,
          user,
          input.caption,
        ),
      );
    }

    // MINDIG LISTA, EGY FÁJLNÁL IS.
    //
    // Az első alak egy fájlnál objektumot adott vissza, többnél tömböt - és a
    // fordító azonnal megfogta, egy hívóban, ami az `.id` mezőt olvasta. Jól
    // tette: egy válasz, aminek a TÍPUSA a bemenettől függ, minden hívót arra
    // kényszerít, hogy kitalálja, melyik ágon jár. A lista mindkét esetben
    // ugyanaz a szerződés, és a hívó egy sorral igazodik hozzá.
    return created;
  }

  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  /*
    A `no-store` DONTES, NEM MULASZTAS. A teljes indoklas a
    `service-job-documents.controller.ts` ugyanezen fejlecen all; roviden: a
    belyegkep-ut ota a nyereseg kicsi, a szerviz-fenykep uzemi kep a partner
    telephelyerol, es egy gyorsitotarazott peldany a bongeszo lemezen maradna.
    A kerdes ujranyitasa adatvedelmi dontes, nem fejlesztoi valasztas.
  */
  @Header("Cache-Control", "private, no-store")
  async downloadDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    /**
     * MELYIK VALTOZAT. `thumbnail` eseten a csempe kepe, minden mas ertek
     * (beleertve a hianyzot es az elgepeltet) az EREDETI -- az a biztonsagos
     * irany: egy elirt parameter teljes meretu kepet ad, nem uresat.
     *
     * A LETOLTES EZT SOHA NEM ADJA MEG, es ez megkotes: a letoltes, a PDF es a
     * hiteles peldany a teljes meretu fajlbol megy.
     */
    @Query("variant") variant?: string,
  ) {
    // A KET FORRAS KOZTI DONTES A SZOLGALTATASE, nem a controlleré: az a
    // dolga, hogy a valaszt osszerakja, nem az, hogy tudja, hol allnak a
    // bajtok. Igy a tarolo bekotese egy helyen valtozik.
    const document = await this.service.documentBytes(
      id,
      documentId,
      user,
      variant,
    );

    return new StreamableFile(document.bytes, {
      type: document.contentType,
      length: document.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  /**
   * A TORLES SAJAT VEGPONT, es SAJAT jog alatt all, nem a SERVICE_MANAGE alatt:
   * eszkozt felvinni a napi szerviz-munka, egy eszkozt megszuntetni viszont
   * visszafordithatatlan. A `SERVICE_ASSET_DELETE` jogot a MANAGER sem kapja meg.
   */
  @Delete(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_ASSET_DELETE)
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  /**
   * A FELIRAT ATIRASA. `PATCH`, mert a sornak EGY mezojet mozditja -- a
   * csatolmany tobbi adata (fajl, meret, lenyomat) a feltoltes pillanatabol
   * valo, es nem is irhato felul.
   */
  @Patch(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setDocumentCaption(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() input: UpdateAssetDocumentCaptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setDocumentCaption(id, documentId, input.caption, user);
  }

  @Delete(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async deleteDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.deleteDocument(id, documentId, user.id, user);
    return { ok: true as const };
  }
}
