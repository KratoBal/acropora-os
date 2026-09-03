import { partnerScopeOf } from "../auth/partner-scope.util.js";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AmendWorksheetDto,
  AttachableWorksheetQueryDto,
  CreateWorksheetDepartmentDto,
  CreateWorksheetDto,
  CreateWorksheetLineDto,
  SetWorksheetAssigneesDto,
  SetWorksheetPartnerCodeDto,
  SignWorksheetVersionDto,
  UpdateWorksheetDraftDto,
  UpdateWorksheetLineDto,
  UploadWorksheetDocumentDto,
  WorksheetListQueryDto,
  MAX_WORKSHEET_DOCUMENTS_PER_UPLOAD,
} from "./dto/worksheet.dto.js";
import { WorksheetsService } from "./worksheets.service.js";

@Controller("service/worksheets")
export class WorksheetsController {
  constructor(private readonly service: WorksheetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: WorksheetListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, partnerScopeOf(user));
  }

  @Get("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  departments(
    @Param("customerId") customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.departments(customerId, partnerScopeOf(user));
  }

  @Post("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  createDepartment(
    @Param("customerId") customerId: string,
    @Body() input: CreateWorksheetDepartmentDto,
  ) {
    return this.service.createDepartment(customerId, input);
  }

  /**
   * A partner-rövidítés itt él és nem a vevő-modulban: a mező kizárólag a
   * munkalap miatt létezik. A számnak 2026-08-27 óta nem tagja, de a lezárás
   * megköveteli, tehát a munkalap-modul az, ami elromlik nélküle. Ha egyszer a
   * vevő adatlapján is szerkeszthető lesz, oda költözik.
   */
  @Put("customers/:customerId/partner-code")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setPartnerCode(
    @Param("customerId") customerId: string,
    @Body() input: SetWorksheetPartnerCodeDto,
  ) {
    return this.service.setPartnerCode(customerId, input);
  }

  /**
   * A felelősnek választható kollégák. A `:id` útvonal ELŐTT kell állnia,
   * különben a Nest ezt is munkalap-azonosítónak olvasná.
   *
   * `SERVICE_VIEW` és nem `USERS_MANAGE`: a kiosztáshoz látni kell a
   * neveket, a felhasználó-kezeléshez viszont semmi köze - a szerelőnek nem
   * kell admin jog ahhoz, hogy lássa, ki dolgozik vele egy lapon.
   */
  /**
   * The partners a worksheet may be written for. Before `:id`, like the list
   * above, or Nest would read the path as a worksheet identifier.
   *
   * `SERVICE_VIEW` rather than `PARTNERS_VIEW`: this is the worksheet screen
   * asking whom it may write for, not the partner register being browsed.
   */
  @Get("selectable-partners")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  selectablePartners(@CurrentUser() user: AuthenticatedUser) {
    return this.service.selectablePartners(partnerScopeOf(user));
  }

  /**
   * A HIBAJEGY ALÁ CSATOLHATÓ LAPOK.
   *
   * A FIX SZAKASZ A `:id` FÖLÖTT ÁLL, mint a többi választó - különben a Nest
   * a nevet lap-azonosítónak olvasná.
   *
   * MA NINCS, AKI HÍVJA: hibajegy-modul nem létezik az API-ban (a `ServiceJob`
   * tábla áll, de nulla `create` hívás és egyetlen kontroller sem hivatkozik
   * rá). Ez a végpont ATTÓL nem korai: a hibajegy felülete pontosan ezt a
   * listát fogja kérni, és a szűrés szabálya (mit szabad felkínálni) a
   * munkalap-modul tudása, nem a hibajegyé.
   */
  @Get("attachable")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  attachableWorksheets(
    @Query() query: AttachableWorksheetQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.attachableWorksheets(
      query.customerId,
      partnerScopeOf(user),
    );
  }

  @Get("assignable-users")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  assignableUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.service.assignableUsers(partnerScopeOf(user));
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, partnerScopeOf(user));
  }

  @Get(":id/versions/:version/diff")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  diff(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.diff(id, version, partnerScopeOf(user));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateWorksheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateDraft(@Param("id") id: string, @Body() input: UpdateWorksheetDraftDto) {
    return this.service.updateDraft(id, input);
  }

  /**
   * Sor-szintű műveletek a piszkozaton.
   *
   * A teljes tartalmat cserélő `PATCH :id` megmarad a webes felvitelhez, ahol
   * egy ember szerkeszt. A helyszínen viszont egy lapnak több felelőse lehet,
   * és ott a teljes csere garantáltan törölné a másik szerelő sorait - nem
   * versenyhelyzetként, hanem minden mentésnél.
   */
  @Post(":id/lines")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  addLine(@Param("id") id: string, @Body() input: CreateWorksheetLineDto) {
    return this.service.addLine(id, input);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() input: UpdateWorksheetLineDto,
  ) {
    return this.service.updateLine(id, lineId, input);
  }

  @Delete(":id/lines/:lineId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  removeLine(@Param("id") id: string, @Param("lineId") lineId: string) {
    return this.service.removeLine(id, lineId);
  }

  /**
   * A lap felelősei, teljes listaként. `PUT`, mert a beküldött névsor a lap
   * felelőseinek teljes állapota, nem egy hozzáadás.
   */
  @Put(":id/assignees")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setAssignees(
    @Param("id") id: string,
    @Body() input: SetWorksheetAssigneesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setAssignees(id, input, user.id);
  }

  /**
   * A signed sheet is final, so the work continues on a NEW sheet that points
   * back at it. `SERVICE_MANAGE`, not the amendment permission: this creates a
   * document rather than rewriting one that was already handed over.
   */
  @Post(":id/continue")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  continueFrom(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.continueFrom(id, user.id);
  }

  @Post(":id/close")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  close(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user.id);
  }

  /**
   * Lezárt munkalap módosítása. Külön jogkör: munkalapot írni és egy már
   * kiadott munkalapot átírni nem ugyanaz a felelősség.
   */
  @Post(":id/versions")
  @RequirePermissions(PERMISSIONS.SERVICE_WORKSHEET_AMEND)
  amend(
    @Param("id") id: string,
    @Body() input: AmendWorksheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.amend(id, input, user.id);
  }

  @Post(":id/sign")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  sign(
    @Param("id") id: string,
    @Body() input: SignWorksheetVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sign(id, input, user.id);
  }

  /**
   * FENYKEP A MUNKALAPHOZ, A HELYSZINROL.
   *
   * UGYANAZ AZ ALAK, MINT AZ ESZKOZNEL, es ez nem masolas: a feltoltes
   * szabalyai a kozos magban allnak (`documents/document-intake.ts`), itt csak
   * a keres bontasa es a darabszam-hatar all.
   *
   * EGGYEL TOBBET ENGEDUNK BE, MINT AMENNYIT ELFOGADUNK: a multer a sajat
   * korlatjat a stream szintjen vagja el, es a hibajat semmi nem alakitja at --
   * a hivo 500-at kapna, holott csak tul sok fajlt jelolt ki.
   */
  @Post(":id/documents")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  @UseInterceptors(
    FilesInterceptor("file", MAX_WORKSHEET_DOCUMENTS_PER_UPLOAD + 1, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadDocument(
    @Param("id") id: string,
    @Body() input: UploadWorksheetDocumentDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!files?.length)
      throw new BadRequestException("A feltöltendő fájl kötelező.");
    if (files.length > MAX_WORKSHEET_DOCUMENTS_PER_UPLOAD)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${MAX_WORKSHEET_DOCUMENTS_PER_UPLOAD} fájl tölthető fel.`,
      );

    // EGYESEVEL, SORBAN, NEM PARHUZAMOSAN: a keret-ellenorzes a mar
    // felhasznalt helyet olvassa a tablabol, es parhuzamos irasoknal mindegyik
    // ugyanazt a regi osszeget latna.
    const created = [];
    for (const file of files) {
      created.push(
        await this.service.addDocument(
          id,
          input.type ?? "PHOTO",
          file,
          user.id,
          partnerScopeOf(user),
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
    return this.service.documents(id, partnerScopeOf(user));
  }

  @Get(":id/documents/:documentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  @Header("Cache-Control", "private, no-store")
  async downloadDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
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
}
