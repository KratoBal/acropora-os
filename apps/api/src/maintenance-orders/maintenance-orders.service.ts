import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import { Prisma } from "@acropora/database";

import { renderMaintenanceOrderFormDocx } from "../maintenance-contracts/maintenance-order-form-docx.js";
import type { MaintenanceOrderFormInput } from "../maintenance-contracts/maintenance-order-form.types.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

import {
  CreateContractJobDto,
  IssueMaintenanceOrderDto,
  RevokeMaintenanceOrderDto,
  UploadCustomerFormDto,
} from "./dto.js";
import {
  createJobFromContractItems,
  ensureOneSite,
  siteForContractItems,
} from "./job-from-contract-items.js";
import { maintenanceOrderOccasionYear } from "./maintenance-order-occasion-year.js";
import {
  maintenanceOrderNumberPrefix,
  nextMaintenanceOrderNumber,
} from "./maintenance-order-number.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

/**
 * A FOGLALÁS SIKERTELEN ÁGA, 409-KÉNT: elfogyott a keret (a tételek nevével),
 * vagy a zárra várás lejárt (torlódás, nem túllépés: próbáld újra).
 */
function reservationConflict(
  year: number,
  failed: { ok: false; exhausted: string[] } | { ok: false; busy: true },
): ConflictException {
  return "busy" in failed
    ? new ConflictException(
        "A szerződés alkalomkeretét most egy másik művelet foglalja. Próbáld újra.",
      )
    : new ConflictException(
        `A következő tételeknél ${year}-ban elfogyott az évi alkalomkeret: ${failed.exhausted.join(", ")}.`,
      );
}

/**
 * A KULCS ALATT TALÁLT LAP FOLYTATHATÓ-E (barracuda 31714): lemondott lapra
 * nem kerülhet tételsor (egy közben felszabadult alkalommal a hívás sikert
 * mondana egy lemondott lapról), és egy másik szerződés lapjához tartozó kulcs
 * hibás kliens jele.
 */
function assertContinuable(
  job: { status: string; contractId: string | null },
  contractId: string,
): void {
  if (job.status === "CANCELLED")
    throw new ConflictException(
      "Ez a karbantartási lap le van mondva. Új lapot kezdj.",
    );
  if (job.contractId !== contractId)
    throw new ConflictException(
      "Ez a kérés-azonosító egy másik szerződés karbantartási lapjához tartozik. Új lapot kezdj.",
    );
}

@Injectable()
export class MaintenanceOrdersService {
  constructor(
    private readonly repository: MaintenanceOrdersRepository,
    private readonly serviceJobs: ServiceJobsService,
    private readonly worksheets: WorksheetsService,
  ) {}

  list(contractId: string) {
    return this.repository.list(contractId);
  }

  async detail(id: string) {
    const order = await this.repository.detail(id);
    if (!order) throw new NotFoundException("A megrendelőlap nem található.");
    return order;
  }

  async document(orderId: string, documentId: string) {
    const document = await this.repository.document(orderId, documentId);
    if (!document || !document.content)
      throw new NotFoundException("A dokumentum nem található.");
    return { ...document, bytes: document.content };
  }

  /**
   * A KIÁLLÍTÁS: ELLENŐRZÉS, PDF, TÁROLÁS -- EBBEN A SORRENDBEN.
   *
   * Minden ellenőrzés a PDF előállítása ELŐTT fut, ugyanazért, amiért a
   * munkalap felvitele is így teszi: egy elkésett hiba egy MÁR legenerált,
   * de eldobott PDF-fel járna, feleslegesen.
   */
  async issue(dto: IssueMaintenanceOrderDto, actor: AuthenticatedUser) {
    const contract = await this.orderableContract(dto);

    const now = new Date();
    const occasionYear = maintenanceOrderOccasionYear(now);

    const address = await this.repository.defaultAddress(contract.customer.id);
    const orderFormInput: MaintenanceOrderFormInput = {
      customer: {
        name: contract.customer.displayName,
        address: address
          ? [
              address.line1,
              address.line2,
              `${address.postalCode} ${address.city}`,
            ]
              .filter((part): part is string => Boolean(part))
              .join(", ")
          : "",
        organizationalUnitName: contract.organizationalUnitName ?? undefined,
        contactPersonName: contract.contactPersonName ?? undefined,
      },
      contractNumber: contract.number,
      items: contract.items.map((item) => ({
        position: item.position,
        description: item.description,
        unitPricePerOccasion: item.unitNet,
        quantity: item.quantity,
        // EGY KIÁLLÍTÁS EGY-EGY ALKALMAT VISZ TÉTELENKÉNT -- a szerződés
        // `occasionsPerYear`-je az ÉVES keret, nem ennek a lapnak a sora.
        occasionsPerYear: 1,
        vatRatePercent: item.vatRatePercent,
      })),
      subject: contract.title,
      issuedAt: now.toISOString(),
      sequenceNumber: "",
    };

    const last = await this.repository.lastNumberOfYear(
      maintenanceOrderNumberPrefix(occasionYear),
    );
    const number = nextMaintenanceOrderNumber({
      year: occasionYear,
      lastNumber: last,
    });
    orderFormInput.sequenceNumber = number;

    /*
      AZ INTEGRITÁS-ELLENŐRZÉS ITT MÁR NEM `detectUploadedFileKind` --
      az egy FELTÖLTÖTT fájlok bájt-jel alapú felismerésére épült (lásd a
      saját fejlécét: "pdf" | "jpeg" | "png"), docx-et nem ismer, és ez a
      fájl amúgy sem feltöltés, hanem a szerveren ÁLLÍTJUK elő. A valódi
      integritás-kérdés itt az, amit Balázs is kért: a docx MEGNYÍLIK-e, és
      a tételek száma EGYEZIK-e a bemenettel -- ezt a `renderMaintenanceOrderFormDocx`
      saját `itemCount`-ja adja vissza (a `docxtemplater` maga dobna hibát,
      ha a sablon vagy a kitöltés eltört volna, tehát a sikeres visszatérés
      már önmagában bizonyítja, hogy a docx megnyitható).
    */
    const rendered = await renderMaintenanceOrderFormDocx(orderFormInput);
    if (rendered.itemCount !== orderFormInput.items.length)
      throw new Error(
        "A generált megrendelőlap tételszáma nem egyezik a bemenettel. A rendelés nem jött létre, mert épp ezt neveznénk hitelesnek.",
      );

    /*
      AZ ALKALOMKERET A BESZÚRÁSSAL EGY TRANZAKCIÓBAN, SZERZŐDÉSENKÉNTI ZÁRRAL
      (`reserveOccasions`): korábban a számlálás itt, a PDF előállítása előtt
      futott, a beszúrás pedig utána, tehát két egyidejű kiállítás ugyanazt a
      maradékot láthatta. A keret ma a megrendelőlap nélküli lapokat is
      számolja (felmérés S0/1).
    */
    let reserved;
    try {
      reserved = await this.repository.reserveOccasions(
        {
          contractId: contract.id,
          year: occasionYear,
          items: contract.items.map((item) => ({
            contractItemId: item.id,
            description: item.description,
            occasionsPerYear: item.occasionsPerYear,
          })),
        },
        (tx) =>
          this.repository.issue(
            {
              contractId: contract.id,
              number,
              occasionYear,
              issuedByName: actor.displayName,
              items: contract.items.map((item) => ({
                contractItemId: item.id,
                description: item.description,
                unitNet: item.unitNet,
                quantity: item.quantity,
                vatRatePercent: item.vatRatePercent,
              })),
              document: {
                fileName: `megrendelolap-${number}.docx`,
                contentType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeBytes: rendered.content.length,
                content: rendered.content,
              },
            },
            tx,
          ),
      );
    } catch (error) {
      /*
        A SZÁM ITT NEM FELHASZNÁLÓI BEVITEL, hanem a `nextMaintenanceOrderNumber`
        által számolt, sorban következő érték -- egy P2002 itt VERSENYHELYZETET
        jelent (két egyidejű kiállítás ugyanabból a "legutolsó szám"-ból
        indult), nem elgépelést. Ugyanaz a hibaosztály, amit acrobot a
        szerződésszámnál jelzett (31f8c5b4): a nyers P2002 helyett magyar,
        409-es üzenet kell, ami a helyes teendőt (újrapróbálás) mondja, nem
        azt, hogy "javítsd ki a mezőt" -- itt nincs mező, amit javítani lehetne.
      */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          `A(z) ${number} megrendelőlap-szám időközben már kiosztásra került. Próbáld újra.`,
        );
      throw error;
    }
    if (!reserved.ok) throw reservationConflict(occasionYear, reserved);
    return reserved.value;
  }

  /**
   * AZ ALÁÍRT PÉLDÁNY VISSZAJÖTT -- ELLENŐRZÉS, MAJD TÁROLÁS, MAJD A
   * KARBANTARTÁSI LAP. IDEMPOTENS: EGY MEGSZAKADT PRÓBÁLKOZÁS
   * ÚJRAINDÍTVA A FÉLBEMARADT ÁLLAPOTBÓL FEJEZŐDIK BE, NEM DUPLIKÁL.
   *
   * Balázs éles hibája (2026-09-24 21:48, staging), acrobot kártyája
   * 8b1fd497: ma este élesben fut, tehát a folyamat NEM állhat félbe úgy,
   * hogy egy újrapróbálkozás kárt tesz. A négy lépés (dokumentum mentése,
   * állapotváltás, karbantartási lap, munkalapok) HÁROM különböző
   * szolgáltatáson (ez, `ServiceJobsService`, `WorksheetsService) megy át
   * -- egyetlen közös DB-tranzakcióba fogni mindet szélesebb refaktor
   * lenne, kockázatosabb, mint amit egy éles esti kiadás előtt vállalni
   * érdemes. A választott irány ehelyett IDEMPOTENCIA, lépésenként:
   *
   *   1. dokumentum + `SIGNED` állapot: EGY tranzakcióban
   *      (`saveSignedDocumentAndMarkSigned`) -- vagy mindkettő megtörténik,
   *      vagy egyik sem. Az `order.status` ezután MEGMONDJA, hogy ez a
   *      lépés kell-e még: ha már `SIGNED`, egy retry NEM fut le újra.
   *   2. karbantartási lap: `ServiceJobsService.create()`-nek MEGY egy
   *      determinisztikus `clientOperationId` (`maintenance-order-<id>-signed`)
   *      -- ez a mechanizmus MÁR LÉTEZIK (a helyszíni jegyfelvitel
   *      idempotenciája), csak eddig nem volt ide bekötve. Egy retry
   *      ugyanazt a sort kapja vissza, nem újat.
   *   3. munkalapok tételenként: ugyanígy, `maintenance-order-<id>-worksheet-<contractItemId>`
   *      kulccsal (`WorksheetsService.create()` ugyanezt a mintát ismeri).
   *   4. a lap hozzárendelése a rendeléshez (`attachServiceJob`): egy sima
   *      UPDATE, önmagában is ismételhető (ugyanazt az értéket írja be).
   *
   * A "MÁR TELJESEN KÉSZ" állapotot a `status === SIGNED && serviceJobId`
   * együttes megléte jelzi -- CSAK EZ utasítja el az újbóli feltöltést.
   * `SIGNED`, de `serviceJobId` NÉLKÜL azt jelenti, hogy egy KORÁBBI
   * próbálkozás az 1. lépésig jutott, és ezt a hívást FOLYTATÁSKÉNT kell
   * kezelni, nem elutasítani.
   */
  async uploadSignedDocument(
    id: string,
    file: Express.Multer.File,
    actor: AuthenticatedUser,
  ) {
    const order = await this.detail(id);
    if (order.status === "REVOKED")
      throw new BadRequestException(
        "Ez a megrendelőlap vissza lett vonva, aláírt példány nem tölthető fel hozzá.",
      );
    if (order.status === "SIGNED" && order.serviceJobId)
      throw new BadRequestException("Ez a megrendelőlap már alá van írva.");

    /*
      A KARBANTARTÁSI LAP HELYSZÍNE MINDIG ELDŐL, MÉG A DOKUMENTUM MENTÉSE
      ELŐTT -- akkor is, ha ez a hívás valójában egy megszakadt próbálkozás
      folytatása. NEM VÁRT ÁLLAPOT, ha egy tételnek időközben (a kiállítás
      ÓTA) nincs helyszíne -- a kiállítás ezt már kizárta. Hangosan állunk
      meg: egy csendben kihagyott tétel egy vevő által aláírt lapról néma
      hiány lenne.
    */
    // a hibajegy a közös helyszínre kerül, a munkalapok a tételek sajátjára
    const items = order.items.map((item) => ({
      id: item.contractItem.id,
      departmentId: item.contractItem.departmentId,
      description: item.description,
      quantity: item.quantity.toNumber(),
    }));
    const departmentId = await siteForContractItems(this.repository, items);

    if (order.status === "ISSUED") {
      await this.acceptPdf(file);
      await this.repository.saveSignedDocumentAndMarkSigned(id, file);
    }

    /*
      A LAP ÉS A MUNKALAPOK A KÖZÖS ÚTON (karbantartási felmérés S3): az
      eszközök a szerződésből jönnek, a lap a tételek eszközeinek uniója, a
      munkalap a saját tételéé (S1). A kulcsok a mai kulcsok, hogy egy
      újrafuttatás ugyanazt a sort találja.

      VISSZAMENŐLEG NEM PÓTOL: egy már aláírt megrendelőlap lapja egy
      újrahívásra is a meglévő sort adja vissza (`clientOperationId`), tehát
      az akkor eszköz nélkül létrejött lapok eszköz nélkül maradnak.
    */
    const { serviceJobId } = await createJobFromContractItems(
      {
        repository: this.repository,
        serviceJobs: this.serviceJobs,
        worksheets: this.worksheets,
      },
      {
        title: `${order.contract.title} (${order.number})`,
        contract: {
          id: order.contract.id,
          customerId: order.contract.customerId,
        },
        departmentId,
        items,
        jobOperationId: `maintenance-order-${order.id}-signed`,
        worksheetOperationIdPrefix: `maintenance-order-${order.id}-worksheet-`,
        source: `maintenance-order ${order.id}`,
      },
      actor,
    );

    return this.repository.attachServiceJob(id, serviceJobId);
  }

  /**
   * MIRŐL KÉSZÜLHET MEGRENDELŐLAP: a kiállítás és a vevő saját megrendelőlapja
   * (S6) ugyanazokon a szabályokon megy át: aktív szerződés, nem beszerzési és
   * nem javítási, a tételek a szerződéséi, mindnek van helyszíne, és egy
   * helyszínre (vagy közös felső helyszínre) esnek.
   */
  private async orderableContract(dto: {
    contractId: string;
    itemIds: string[];
  }) {
    const itemIds = [...new Set(dto.itemIds)];
    const contract = await this.repository.contractForIssuance(
      dto.contractId,
      itemIds,
    );
    if (!contract) throw new NotFoundException("A szerződés nem található.");
    if (contract.status !== "ACTIVE")
      throw new BadRequestException(
        "Csak aktív szerződésre állítható ki megrendelőlap.",
      );
    // A beszerzési szerződésből számla készül, nem megrendelőlap (hétfői lista M4),
    // és a javításiból sem készül (karbantartási felmérés S0/3).
    if (contract.kind === "PURCHASE")
      throw new BadRequestException(
        "Beszerzési szerződésre nem állítható ki megrendelőlap.",
      );
    if (contract.kind === "REPAIR")
      throw new BadRequestException(
        "Javítási szerződésre nem állítható ki megrendelőlap.",
      );
    if (contract.items.length !== itemIds.length)
      throw new BadRequestException(
        "A megadott tételek között olyan van, ami nem ehhez a szerződéshez tartozik, vagy már nem létezik.",
      );

    /*
      A HELYSZÍN NÉLKÜLI TÉTELBŐL NEM LEHET MUNKALAP -- ezt itt, KIÁLLÍTÁSKOR
      kérjük számon, nem csak aláíráskor. Enélkül egy megrendelőlap kimenne,
      aláírva visszajönne, és csak AKKOR derülne ki, hogy a karbantartási
      lapot nem lehet belőle megcsinálni -- a legrosszabb pillanatban.
    */
    const helyszinNelkul = contract.items.filter((item) => !item.departmentId);
    if (helyszinNelkul.length)
      throw new BadRequestException(
        `A következő tételekhez nincs megadva helyszín a szerződésen, ezért nem állítható ki belőlük megrendelőlap: ${helyszinNelkul
          .map((item) => item.description)
          .join(", ")}.`,
      );

    /*
      EGY MEGRENDELŐLAP EGY HELYSZÍNRE KÉSZÜL, és ez a tételek KÖZÖS FELSŐ
      HELYSZÍNE is lehet (Balázs döntése, 2026-10-02 07:36 UTC, kártya
      1806e061; az éles eset a Capasuli és három medencéje). Tényleg
      független helyszíneknél itt, KIÁLLÍTÁSKOR állunk meg, és megnevezzük
      őket (`uploadSignedDocument` ugyanezt ellenőrzi).
    */
    await this.ensureOneSite(
      contract.items.map((item) => item.departmentId as string),
    );
    return contract;
  }

  /** Csak valódi PDF, és csak ha a dokumentum-tárban van még hely. */
  private async acceptPdf(file: Express.Multer.File) {
    if (
      file.mimetype !== "application/pdf" ||
      !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new BadRequestException("Csak valódi PDF-fájl tölthető fel.");
    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      const quota = decideQuota({
        usedBytes: await sumDocumentBytesInUse(),
        incomingBytes: file.buffer.length,
        limitBytes,
      });
      if (quota.state === "reject") throw new ConflictException(quota.reason);
    }
  }

  /** A helyszín-szabály a közös úton áll (`job-from-contract-items.ts`). */
  private ensureOneSite(departmentIds: readonly string[]): Promise<string> {
    return ensureOneSite(this.repository, departmentIds);
  }

  /**
   * A VEVŐ SAJÁT MEGRENDELŐLAPJA, FELTÖLTVE (karbantartási felmérés S6).
   *
   * Ugyanaz a rendelés, mint egy kiállított és aláírt megrendelőlap, csak a
   * dokumentumot a vevő adja: a szerződés-szabályok, a számozás és az
   * alkalomkeret ugyanaz (`orderableContract`, `reserveOccasions`), a sor
   * `CUSTOMER_FORM` forrással, rögtön `SIGNED` állapotban jön létre. A tételek
   * és az ár a szerződésből jönnek, a PDF-ből semmit nem olvasunk ki (S0/2):
   * ha a vevő lapja más árat mond, az a szerződés módosítása.
   *
   * A LAP ÉS A MUNKALAPOK UGYANAZON AZ ÚTON, mint az aláírásnál: a rendelés
   * `SIGNED`, lap nélkül jön létre, és az `uploadSignedDocument` folytatási
   * ága (SIGNED, `serviceJobId` nélkül) készíti el őket, ugyanazokkal a
   * kulcsokkal. Ha ez a lépés megszakad, az aláírt-dokumentum végpont
   * ugyanerre a rendelésre folytatja, ahogy egy megszakadt aláírást.
   */
  async uploadCustomerForm(
    dto: UploadCustomerFormDto,
    file: Express.Multer.File,
    actor: AuthenticatedUser,
  ) {
    const contract = await this.orderableContract(dto);
    await this.acceptPdf(file);

    const occasionYear = maintenanceOrderOccasionYear(new Date());
    const number = nextMaintenanceOrderNumber({
      year: occasionYear,
      lastNumber: await this.repository.lastNumberOfYear(
        maintenanceOrderNumberPrefix(occasionYear),
      ),
    });

    let reserved;
    try {
      reserved = await this.repository.reserveOccasions(
        {
          contractId: contract.id,
          year: occasionYear,
          items: contract.items.map((item) => ({
            contractItemId: item.id,
            description: item.description,
            occasionsPerYear: item.occasionsPerYear,
          })),
        },
        async (tx) => {
          const duplicate = await this.repository.customerFormDuplicate(
            {
              contractId: contract.id,
              itemIds: contract.items.map((item) => item.id),
              content: file.buffer,
            },
            tx,
          );
          if (duplicate) return { duplicate };
          const order = await this.repository.createCustomerForm(
            {
              contractId: contract.id,
              number,
              occasionYear,
              issuedByName: actor.displayName,
              items: contract.items.map((item) => ({
                contractItemId: item.id,
                description: item.description,
                unitNet: item.unitNet,
                quantity: item.quantity,
                vatRatePercent: item.vatRatePercent,
              })),
              document: {
                fileName: file.originalname,
                contentType: file.mimetype,
                content: file.buffer,
              },
            },
            tx,
          );
          return { order };
        },
      );
    } catch (error) {
      // a kiállítással azonos versenyhelyzet: a számot közben más kapta meg
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          `A(z) ${number} megrendelőlap-szám időközben már kiosztásra került. Próbáld újra.`,
        );
      throw error;
    }
    if (!reserved.ok) throw reservationConflict(occasionYear, reserved);
    const { duplicate, order } = reserved.value;
    if (duplicate) {
      /*
        AZ ÚJRAKÜLDÉS ÖNMAGÁT GYÓGYÍTJA (barracuda, #1708): ha az első
        próbálkozás a sort már létrehozta, de a lap közben elhasalt, ugyanez a
        hívás a meglévő rendelésre folytat, ahogy egy megszakadt aláírás. Ha a
        lap már megvan, ez valódi kettős beküldés: 409, a meglévő számmal.
      */
      if (!duplicate.serviceJobId)
        return this.uploadSignedDocument(duplicate.id, file, actor);
      throw new ConflictException(
        `Ez a vevői megrendelőlap ugyanezekkel a tételekkel már fel van töltve (${duplicate.number}).`,
      );
    }
    if (!order) throw new Error("A vevői megrendelőlap sora nem jött létre.");
    return this.uploadSignedDocument(order.id, file, actor);
  }

  async revoke(
    id: string,
    dto: RevokeMaintenanceOrderDto,
    actor: AuthenticatedUser,
  ) {
    const order = await this.detail(id);
    if (order.status !== "ISSUED")
      throw new BadRequestException(
        order.status === "SIGNED"
          ? "Ez a megrendelőlap már alá van írva, nem vonható vissza."
          : "Ez a megrendelőlap már vissza van vonva.",
      );
    return this.repository.markRevoked(
      id,
      actor.displayName,
      dto.reason?.trim() || null,
    );
  }

  /**
   * KARBANTARTÁSI LAP A SZERZŐDÉSBŐL, MEGRENDELŐLAP NÉLKÜL (karbantartási
   * felmérés S4, B út; Balázs 2026-10-15). A helyszín és az eszközök a
   * szerződésből jönnek (a közös S3 út), a lap fedett tételei a
   * `ServiceJobContractItem` sorokba kerülnek árrögzítéssel, és az éves
   * alkalomkeretet ugyanaz a zár védi, mint a kiállítást. Ár a lapra nem kerül.
   *
   * A SORREND, ÉS MIÉRT ILYEN: a lapot és a munkalapokat a meglévő
   * szolgáltatások hozzák létre, saját adatbázis-kapcsolattal, tehát a lap nem
   * kerülhet a foglalás tranzakciójába. Ezért:
   *   1. ELŐELLENŐRZÉS a zár alatt, írás nélkül: a szokásos túllépés így lap
   *      létrehozása NÉLKÜL ad 409-et;
   *   2. a lap és a munkalapok, idempotens kulccsal (`contract-job-<kulcs>`);
   *   3. a tételsorok beszúrása, ÚJRA a zár alatt. Ha közben egy párhuzamos
   *      foglalás elvitte az utolsó alkalmat, a friss lapot LEMONDJUK (a
   *      napló megmarad, a keret nem lép túl), és 409 jön.
   * Egy újrahívás ugyanazzal a kulccsal a meglévő lapot kapja vissza; ha annak
   * már vannak tételsorai, a foglalás nem fut újra.
   */
  async createJobFromContract(
    dto: CreateContractJobDto,
    actor: AuthenticatedUser,
  ) {
    const itemIds = [...new Set(dto.itemIds)];
    const contract = await this.repository.contractForIssuance(
      dto.contractId,
      itemIds,
    );
    if (!contract) throw new NotFoundException("A szerződés nem található.");
    if (contract.status !== "ACTIVE")
      throw new BadRequestException(
        "Csak aktív szerződésből készíthető karbantartási lap.",
      );
    // a beszerzésiből számla, a javításiból (felmérés S0/3) semmilyen karbantartási lap nem készül
    if (contract.kind !== "MAINTENANCE")
      throw new BadRequestException(
        "Csak karbantartási szerződésből készíthető karbantartási lap.",
      );
    if (contract.items.length !== itemIds.length)
      throw new BadRequestException(
        "A megadott tételek között olyan van, ami nem ehhez a szerződéshez tartozik, vagy már nem létezik.",
      );

    const items = contract.items.map((item) => ({
      id: item.id,
      departmentId: item.departmentId,
      description: item.description,
      quantity: item.quantity.toNumber(),
    }));
    const departmentId = await siteForContractItems(this.repository, items);
    const reservation = {
      contractId: contract.id,
      items: contract.items.map((item) => ({
        contractItemId: item.id,
        description: item.description,
        occasionsPerYear: item.occasionsPerYear,
      })),
    };
    const nowYear = maintenanceOrderOccasionYear(new Date());
    const key = dto.clientOperationId?.trim() || randomUUID();

    /*
      A KULCS ALATTI LAP, MÉG A LÉTREHOZÁS ELŐTT (barracuda 31714, 31720).
      Lemondott lapot nem folytatunk, és egy másik szerződés lapja alá nem
      teszünk munkalapot (az új kérés tételeinek munkalap-kulcsai újak
      lennének, tehát a 409 előtt idegen munkalapok keletkeznének). Ha a lapnak
      már vannak tételsorai, az előellenőrzés kimarad: a saját sorait
      felhasználásnak látná, és egy sikeres újrahívást utasítana el.
    */
    const existing = await this.repository.serviceJobContractItemState({
      clientOperationId: `contract-job-${key}`,
    });
    if (existing) assertContinuable(existing, contract.id);

    if (!existing || existing.itemCount === 0) {
      const precheck = await this.repository.reserveOccasions(
        { ...reservation, year: nowYear },
        async () => null,
      );
      if (!precheck.ok) throw reservationConflict(nowYear, precheck);
    }

    const { serviceJobId } = await createJobFromContractItems(
      {
        repository: this.repository,
        serviceJobs: this.serviceJobs,
        worksheets: this.worksheets,
      },
      {
        title: dto.title?.trim() || contract.title,
        contract: { id: contract.id, customerId: contract.customer.id },
        departmentId,
        items,
        jobOperationId: `contract-job-${key}`,
        worksheetOperationIdPrefix: `contract-job-${key}-worksheet-`,
        source: `contract-job ${key}`,
      },
      actor,
    );

    const state = await this.repository.serviceJobContractItemState({
      id: serviceJobId,
    });
    if (!state)
      throw new Error(
        `A most létrehozott ${serviceJobId} karbantartási lap nem található.`,
      );
    // ugyanaz az ellenőrzés a létrehozás után is: egy párhuzamos kérés
    // ugyanazzal a kulccsal közben hozhatta létre a lapot
    assertContinuable(state, contract.id);
    if (state.itemCount > 0) return { serviceJobId };

    const year = maintenanceOrderOccasionYear(state.createdAt);
    const reserved = await this.repository.reserveOccasions(
      { ...reservation, year },
      (tx) =>
        this.repository.insertServiceJobContractItems(
          tx,
          serviceJobId,
          contract.items.map((item) => ({
            contractItemId: item.id,
            description: item.description,
            unitNet: item.unitNet,
            quantity: item.quantity,
            vatRatePercent: item.vatRatePercent,
          })),
        ),
    );
    if (!reserved.ok) {
      await this.serviceJobs.move(
        serviceJobId,
        {
          to: "CANCELLED",
          note: "A szerződés alkalomkeretét a lap létrehozása közben egy párhuzamos foglalás elvitte; a lap tételek nélkül lemondva.",
        },
        actor.id,
        actor,
      );
      throw reservationConflict(year, reserved);
    }
    return { serviceJobId };
  }
}
