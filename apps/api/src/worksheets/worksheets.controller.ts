import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
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
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AmendWorksheetDto,
  AttachableWorksheetQueryDto,
  CreateWorksheetDepartmentDto,
  CreateWorksheetDto,
  CreateWorksheetEntryDto,
  CreateWorksheetLineDto,
  SetWorksheetAssetsDto,
  SetWorksheetAssigneesDto,
  SetWorksheetPartnerCodeDto,
  SendWorksheetForSignatureDto,
  SignWorksheetVersionDto,
  UpdateWorksheetDraftDto,
  UpdateWorksheetEntryDto,
  UpdateWorksheetLineDto,
  UpdateWorksheetDocumentCaptionDto,
  UploadWorksheetDocumentDto,
  SetWorksheetHandedOverDto,
  SetWorksheetHiddenDto,
  WorksheetListQueryDto,
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
    return this.service.list(
      query,
      user,
      hasPermission(user, PERMISSIONS.SERVICE_HIDE),
    );
  }

  @Get("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  departments(
    @Param("customerId") customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.departments(customerId, partnerScopeOf(user), user.id);
  }

  @Post("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  createDepartment(
    @Param("customerId") customerId: string,
    @Body() input: CreateWorksheetDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createDepartment(user, customerId, input);
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setPartnerCode(user, customerId, input);
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
    return this.service.create(input, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateDraft(
    @Param("id") id: string,
    @Body() input: UpdateWorksheetDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateDraft(id, input, user);
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
  addLine(
    @Param("id") id: string,
    @Body() input: CreateWorksheetLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addLine(id, input, user);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() input: UpdateWorksheetLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateLine(id, lineId, input, user);
  }

  /**
   * AKI ALAIRHATJA A LAPOT: a lap partnerenek nyilvantartott munkatarsai.
   *
   * `SERVICE_VIEW`, mert ez OLVASAS -- a valaszto a szerelo eszkoze, es a
   * szerelo a lapot amugy is latja. Az ALAIRAS maga tovabbra is
   * `SERVICE_MANAGE` alatt all.
   */
  @Get(":id/signers")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  signers(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.signerCandidates(id, partnerScopeOf(user), user.id);
  }

  /**
   * A MUNKANAPLO. OLVASNI `SERVICE_VIEW`, IRNI `SERVICE_MANAGE` -- ugyanaz a
   * paros, mint a lap tobbi reszen.
   *
   * A HATOKOR BELSOS, es azt a szolgaltatas mondja ki, nem ez a sor: a
   * bejegyzes a MI munkanaplonk, es Balazs nem kerte, hogy a partner lassa.
   */
  @Get(":id/entries")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  entries(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.entries(id, user.id);
  }

  @Post(":id/entries")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  addEntry(
    @Param("id") id: string,
    @Body() input: CreateWorksheetEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addEntry(id, input.body, user);
  }

  /**
   * A SZERKESZTES JOGA A SZOLGALTATASBAN DOL EL, nem itt: a `SERVICE_MANAGE`
   * csak azt mondja meg, hogy egyaltalan irhat-e a lapokra. Hogy EZT a
   * bejegyzest atirhatja-e, az a lap keszitojetol es a jegy nyitojatol fugg,
   * es azt egy dekorátor nem tudja.
   */
  @Patch(":id/entries/:entryId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateEntry(
    @Param("id") id: string,
    @Param("entryId") entryId: string,
    @Body() input: UpdateWorksheetEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateEntry(id, entryId, input.body, user);
  }

  @Delete(":id/lines/:lineId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  removeLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeLine(id, lineId, user);
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
    /*
      A TELJES KERO MEGY AT, NEM CSAK AZ AZONOSITOJA. Ez a vegpont eddig is
      megkapta a felhasznalot, de CSAK aktorkent hasznalta -- a hatokor
      leszarmaztatasahoz a teljes sor kell.
    */
    return this.service.setAssignees(id, input, user);
  }

  /**
   * A LAP ESZKOZEI, teljes listakent. `PUT`, ugyanabbol az okbol, amiert a
   * felelosoknel: a bekuldott lista a lap eszkozeinek TELJES allapota, nem egy
   * hozzaadas.
   *
   * AZ ALLAPOT NEM SZAMIT, ES EZ A MODELLBOL KOVETKEZIK: a `WorksheetAsset` a
   * MUNKALAPHOZ kotodik, nem a verziohoz -- ugyanugy, mint a felelosok, akiket
   * a `setAssignees` ma is enged barmilyen allapotu lapon. Nem verziozott
   * tartalom, tehat nem az amend jogkor ala tartozik.
   */
  @Put(":id/assets")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setAssets(
    @Param("id") id: string,
    @Body() input: SetWorksheetAssetsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setAssets(id, input, user);
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
    return this.service.continueFrom(id, user);
  }

  /**
   * A LAP ELREJTESE ES VISSZAALLITASA -- EGY UT, TORZSBEN KAPOTT JELOLOVEL.
   *
   * Balazs kerese, 2026-09-18 08:01 UTC: "tunjenek el". A probalapok
   * kikerulnek a listakbol, es MEGMARADNAK -- a reszletlap azonositoval
   * tovabbra is elerheto.
   *
   * `SERVICE_MANAGE`, ugyanaz a jog, ami a lap szerkeszteset engedi: a rejtes
   * nem uj hatalom, hanem ugyanannak a lapnak a kezelese. A hatokor-korlatot
   * (csak belso ut) a szolgaltatas ellenorzi.
   */
  @Post(":id/hidden")
  @RequirePermissions(PERMISSIONS.SERVICE_HIDE)
  setHidden(
    @Param("id") id: string,
    @Body() input: SetWorksheetHiddenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHidden(id, input.hidden, user);
  }

  /**
   * AZ ATADAS JELOLESE: VISSZAKERULT-E AZ UGYFEL ESZKOZE.
   *
   * Balazs dontese, 2026-09-21 11:10 UTC: a SZERELO jeloli meg a telefonjan,
   * amikor visszaadja, ES az iroda is tudja allitani a weben. KULON LEPES,
   * nem a lezarashoz vagy az alairashoz kotve -- a muhelyben javitott gepnel
   * az alairas hetekkel megelozheti a visszaszallitast, tehat a ketto
   * osszekotese ott HAZUDNA.
   *
   * MIERT AZ IRODA IS: nem a jobb tudas miatt, hanem hogy JAVITANI lehessen.
   * Ha a szerelo elfelejti, es a jegy emiatt nem zarhato, valakinek meg kell
   * tudnia oldani anelkul, hogy visszakuldenenk a helyszinre.
   *
   * `SERVICE_MANAGE`, ugyanaz a jog, ami a lapot szerkesztheti: az atadas nem
   * uj hatalom, hanem ugyanannak a lapnak a kezelese. A PARTNERT nem ez zarja
   * ki (a `PARTNER_SERVICE` szerep MEGKAPJA a `SERVICE_MANAGE` jogot, merve
   * 2026-09-21), hanem a szolgaltatasban allo hatokor-kapu.
   */
  @Post(":id/handover")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setHandedOver(
    @Param("id") id: string,
    @Body() input: SetWorksheetHandedOverDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHandedOver(id, input.handedOver, user);
  }

  @Post(":id/close")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  close(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user);
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

  /**
   * KIKULDES ALAIRASRA -- A LEZARAS UTANI, KULON LEPES.
   *
   * `SERVICE_MANAGE`, mint a lezaras. A BELSOS hatokort a szolgaltatas
   * koveteli meg, nem ez a sor: a jog es a hatokor ket kulonbozo kerdes, es a
   * `PARTNER_SERVICE` szerep is viseli ezt a jogot.
   */
  @Post(":id/send-for-signature")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  sendForSignature(
    @Param("id") id: string,
    @Body() input: SendWorksheetForSignatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sendForSignature(id, input.signerUserId, user);
  }

  @Post(":id/sign")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  sign(
    @Param("id") id: string,
    @Body() input: SignWorksheetVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sign(id, input, user);
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
    FilesInterceptor("file", DOCUMENT_UPLOAD_LIMITS.files + 1, {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
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
    if (files.length > DOCUMENT_UPLOAD_LIMITS.files)
      throw new BadRequestException(
        `Egyszerre legfeljebb ${DOCUMENT_UPLOAD_LIMITS.files} fájl tölthető fel.`,
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
    return this.service.documents(id, partnerScopeOf(user));
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
    @Body() input: UpdateWorksheetDocumentCaptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setDocumentCaption(
      id,
      documentId,
      input.caption,
      partnerScopeOf(user),
    );
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
    const document = await this.service.documentBytes(
      id,
      documentId,
      partnerScopeOf(user),
      variant,
    );
    return new StreamableFile(document.bytes, {
      type: document.contentType,
      length: document.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }
}
