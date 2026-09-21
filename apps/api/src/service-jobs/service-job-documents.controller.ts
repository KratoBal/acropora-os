import {
  BadRequestException,
  Body,
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
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  UpdateServiceJobDocumentCaptionDto,
  UploadServiceJobDocumentDto,
} from "./service-job-documents.dto.js";
import { ServiceJobDocumentsService } from "./service-job-documents.service.js";

/**
 * A HIBAJEGY CSATOLMANYAI.
 *
 * === MIERT KULON KONTROLLER, UGYANAZON AZ UTVONAL-ELOTAGON ===
 *
 * A `ServiceJobsController` a jegy ELETUTJAT viszi (lista, reszletlap,
 * allapotvaltas, munkalap-csatolas). Ez a negy vegpont bajtokat mozgat:
 * multipart-feldolgozas, letoltes-fejlecek, tarolo-hibak. A ketto kulon
 * romlik el, es kulon is olvashato.
 *
 * AZ UTVONALAK NEM UTKOZNEK: a `@Get(":id")` EGY szegmens, ezek KETTO vagy
 * HAROM. A Nest az elso illeszkedo utat valasztja, es ilyen nincs.
 *
 * === A JOGOSULTSAG A JEGYE, NEM KULON DOKUMENTUM-JOG ===
 *
 * Aki a jegyet latja, a csatolmanyait is latja (`service.view`); aki a jegyet
 * viszi, tolthet fel es torolhet (`service.manage`). Egy kulon jogkor ma csak
 * azt jelentene, hogy valakinel elfelejtjuk bekapcsolni -- ugyanaz az indok,
 * amit a jegy kontrollere mar kimond a sajat fejlecében.
 */
@Controller("service/jobs")
export class ServiceJobDocumentsController {
  constructor(private readonly service: ServiceJobDocumentsService) {}

  /**
   * EGGYEL TOBBET ENGEDUNK BE, MINT AMENNYIT ELFOGADUNK: a multer a sajat
   * korlatjat a stream szintjen vagja el, es a hibajat semmi nem alakitja at --
   * a hivo 500-at kapna, holott csak tul sok fajlt jelolt ki.
   */
  @Post(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  @UseInterceptors(
    FilesInterceptor("file", DOCUMENT_UPLOAD_LIMITS.files + 1, {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  async uploadDocument(
    @Param("id") id: string,
    @Body() input: UploadServiceJobDocumentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!files?.length)
      throw new BadRequestException("A feltöltendő fájl kötelező.");
    if (files.length > DOCUMENT_UPLOAD_LIMITS.files)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${DOCUMENT_UPLOAD_LIMITS.files} fájl tölthető fel.`,
      );

    // EGYESEVEL, SORBAN, NEM PARHUZAMOSAN: a keret-ellenorzes a mar felhasznalt
    // helyet olvassa a tablabol, es parhuzamos irasoknal mindegyik ugyanazt a
    // regi osszeget latna.
    const created = [];
    for (const file of files) {
      created.push(
        await this.service.addDocument(
          id,
          input.type ?? "PHOTO",
          file,
          user,
          input.caption,
        ),
      );
    }
    // MINDIG LISTA, EGY FAJLNAL IS: egy valasz, aminek a TIPUSA a bemenettol
    // fugg, minden hivot arra kenyszerit, hogy kitalalja, melyik agon jar.
    return created;
  }

  @Get(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  documents(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.documents(id, user);
  }

  /**
   * A LETOLTES NEM VOLT A KERESBEN, ES MEGIS ITT ALL.
   *
   * Enelkul a lista ONMAGABAN hasznalhatatlan: nevek es meretek latszananak,
   * de egyetlen kepet sem lehetne megnyitni. A masik ket gazdanal ugyanez a
   * harom vegpont all egyutt.
   */
  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  /*
    A `no-store` DONTES, NEM MULASZTAS -- ES A BELYEGKEP-UT OTA EZ A VEGPONT A
    KEZENFEKVO OPTIMALIZACIOS CELPONT.

    Aki egy kep-vegponton csupasz `no-store`-t lat, elnezesnek olvassa: egy
    galeria ugyanazt a kepet ujra es ujra lehivja, es a gyorsitotarazas
    nagysagrenddel tobbet erne, mint maga a kicsinyites. Ezert all itt az
    indok, nem a kartyan: a kartyat nem talalja meg az, aki epp atirja ezt a
    sort.

    ACROBOT DONTESE, 2026-09-18, harom okbol:

      1. A NYERESEG EPP MOST ZSUGORODOTT. A belyegkep-ut a koltseg nagy reszet
         elviszi (egy eszkoz-galeria atlagos megnyitasa 5,3 MB-rol par szaz
         kilobajtra), tehat ami marad, azert nem er meg uj kockazatot vallalni.
      2. AMIT CSEREBE ADNANK: a szerviz-fenykep UZEMI KEP a partner
         telephelyerol, es egy gyorsitotarazott valtozat a BONGESZO LEMEZEN
         marad -- akar kozos gepen.
      3. A HATAR: ez adatvedelmi dontes, nem fejlesztoi valasztas.

    A FELTETEL, AMI VISSZAHOZZA: ha meresbol latszik, hogy ugyanazt a galeriat
    naponta sokszor nyitjak UGYANAZON a gepen. Es akkor a dontes BALAZSE, nem a
    miénk -- egy SZUKITES nem igenyel engedelyt, egy TAGITAS igen.
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
   * A FELIRAT ATIRASA. `PATCH`, mert a sornak EGY mezojet mozditja -- a
   * csatolmany tobbi adata (fajl, meret, lenyomat) a feltoltes pillanatabol
   * valo, es nem is irhato felul.
   */
  @Patch(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setDocumentCaption(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Body() input: UpdateServiceJobDocumentCaptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setDocumentCaption(id, documentId, input.caption, user);
  }

  @Delete(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  deleteDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteDocument(id, documentId, user);
  }
}
