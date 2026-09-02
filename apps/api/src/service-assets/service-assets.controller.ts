import { partnerScopeOf } from "../auth/partner-scope.util.js";
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
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
  UploadAssetDocumentDto,
} from "./dto/asset.dto.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * Hány fájl mehet egy feltöltési kérésben. A fájlok a memóriában gyűlnek, így
 * a legrosszabb eset ennek és a 10 megabájtos fájlméretnek a szorzata.
 */
export const MAX_DOCUMENTS_PER_UPLOAD = 10;

@Controller("service/assets")
export class ServiceAssetsController {
  constructor(private readonly service: ServiceAssetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: AssetListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, partnerScopeOf(user));
  }

  /**
   * A DOKUMENTUM-TAROLO ALLAPOTA, a telepites ellenorzesehez.
   *
   * A `SERVICE_MANAGE` jog alatt all, es NEM publikus: az utvonalat es a hiba
   * okat mondja ki, ami a rendszer belso felepiteserol beszel. Egy nyilvanos
   * valtozat ezt ingyen adna oda barkinek.
   *
   * A VALASZ MINDIG 200, meg `broken` allapotnal is. Ez szandekos: aki ezt
   * hivja, epp azt akarja MEGTUDNI, mi az allapot -- egy 503 ugyanazt az
   * informaciot rejtene el, amiert a vegpont keszult.
   */
  @Get("document-store")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  documentStoreStatus() {
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
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
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
    return this.service.scanLabel(code, partnerScopeOf(user));
  }

  /**
   * UJ MATRICA-TETEL GENERALASA. SERVICE_MANAGE.
   *
   * MUVELET, NEM LEKERDEZES: rekordot hoz letre, es a vegen KINYOMTATOTT
   * matrica lesz belole a fizikai vilagban. Ket gombnyomas ket tetelt csinal --
   * a lista percre pontos idopontja azert all ott, hogy ez AZONNAL latszodjon.
   */
  @Post("label-batches")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  issueLabelBatch(@Body() input: IssueAssetLabelBatchDto) {
    return this.service.issueBatch(input.count);
  }

  /** A korabbi generalasok: mikor, hany kod, hany szabad meg. */
  @Get("label-batches")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  labelBatches(@Query() query: AssetLabelBatchQueryDto) {
    return this.service.labelBatches(query.limit ?? 50);
  }

  /** Egy nyomtatott iv kodjainak felvitele a keszletbe. */
  @Post("labels")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  issueLabels(@Body() input: IssueAssetLabelsDto) {
    return this.service.issueLabels(input.codes);
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
   * A TULAJDONOST SZANDEKOSAN NEM ELLENORIZZUK (spec 4.1): a token maga a
   * kulcs. A hatokor MEGIS atmegy, mert a dokumentum-tipus szabalya nem a
   * tulajdonosrol szol -- lasd a tarolo `detailByQrToken` jegyzetet.
   */
  @Get("scan/:qrToken")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  scan(
    @Param("qrToken") qrToken: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.scan(qrToken, partnerScopeOf(user));
  }

  @Get(":id/qr")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  qrCode(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.qrCode(id, partnerScopeOf(user));
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, partnerScopeOf(user));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Post(":id/qr/rotate")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  rotateQr(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.rotateQr(id, user.id);
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
    FilesInterceptor("file", MAX_DOCUMENTS_PER_UPLOAD + 1, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
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
    if (files.length > MAX_DOCUMENTS_PER_UPLOAD)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${MAX_DOCUMENTS_PER_UPLOAD} fájl tölthető fel.`,
      );

    // EGYESÉVEL, SORBAN, ÉS NEM PÁRHUZAMOSAN. A keret-ellenőrzés a már
    // felhasznált helyet olvassa a táblából: párhuzamos írásoknál mindegyik
    // ugyanazt a régi összeget látná, és együtt átvinnék a határon úgy, hogy
    // külön-külön mindegyik belefért volna.
    const created = [];
    for (const file of files) {
      created.push(
        await this.service.addDocument(id, input.type, file, user.id),
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
  @Header("Cache-Control", "private, no-store")
  async downloadDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // A KET FORRAS KOZTI DONTES A SZOLGALTATASE, nem a controlleré: az a
    // dolga, hogy a valaszt osszerakja, nem az, hogy tudja, hol allnak a
    // bajtok. Igy a tarolo bekotese egy helyen valtozik.
    const document = await this.service.documentBytes(
      id,
      documentId,
      partnerScopeOf(user),
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

  @Delete(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async deleteDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.deleteDocument(id, documentId, user.id);
    return { ok: true as const };
  }
}
