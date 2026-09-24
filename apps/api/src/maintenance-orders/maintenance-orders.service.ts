import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import { Prisma } from "@acropora/database";

import { renderMaintenanceOrderFormPdf } from "../maintenance-contracts/maintenance-order-form-document.js";
import type { MaintenanceOrderFormInput } from "../maintenance-contracts/maintenance-order-form.types.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

import { IssueMaintenanceOrderDto, RevokeMaintenanceOrderDto } from "./dto.js";
import { maintenanceOrderOccasionYear } from "./maintenance-order-occasion-year.js";
import {
  maintenanceOrderNumberPrefix,
  nextMaintenanceOrderNumber,
} from "./maintenance-order-number.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

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
      EGY KARBANTARTÁSI LAP EGY HELYSZÍNRE KÉSZÜL (Balázs éles hibája,
      2026-09-24 21:48, staging, Állatkert) -- ha a kiállítás tételei
      TÖBB helyszínen vannak, ez itt, KIÁLLÍTÁSKOR derül ki, nem csak az
      aláírás visszaérkezésekor (`uploadSignedDocument`, ugyanez a
      ellenőrzés). A vegyes-helyszínes eset modellje még nincs eldöntve
      (Balázs elé megy), ezért egyelőre megállunk és megnevezzük a
      helyszíneket.
    */
    await this.ensureSingleDepartment(
      contract.items.map((item) => item.departmentId as string),
    );

    const now = new Date();
    const occasionYear = maintenanceOrderOccasionYear(now);
    const counts = await this.repository.issuedOccasionCounts(
      contract.items.map((item) => item.id),
      occasionYear,
    );
    const tulfoglalt = contract.items.filter(
      (item) => (counts.get(item.id) ?? 0) >= item.occasionsPerYear,
    );
    if (tulfoglalt.length)
      throw new ConflictException(
        `A következő tételeknél ${occasionYear}-ban elfogyott az évi alkalomkeret: ${tulfoglalt
          .map((item) => item.description)
          .join(", ")}.`,
      );

    const address = await this.repository.defaultAddress(contract.customer.id);
    const pdfInput: MaintenanceOrderFormInput = {
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
    pdfInput.sequenceNumber = number;

    const content = await renderMaintenanceOrderFormPdf(pdfInput);
    const kind = detectUploadedFileKind("application/pdf", content);
    if (kind === null)
      throw new Error(
        "A generált megrendelőlap nem érvényes PDF. A rendelés nem jött létre, mert épp ezt neveznénk hitelesnek.",
      );

    try {
      return await this.repository.issue({
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
          fileName: `megrendelolap-${number}.pdf`,
          contentType: canonicalMimetypeFor(kind),
          sizeBytes: content.length,
          content,
        },
      });
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
    const helyszinNelkul = order.items.find(
      (item) => !item.contractItem.departmentId,
    );
    if (helyszinNelkul)
      throw new ConflictException(
        `A(z) "${helyszinNelkul.description}" tételhez időközben megszűnt a helyszín-hozzárendelés, ezért nem hozható létre hozzá munkalap. A szerződés tételét előbb rendezni kell.`,
      );
    const departmentId = await this.ensureSingleDepartment(
      order.items.map((item) => item.contractItem.departmentId as string),
    );

    if (order.status === "ISSUED") {
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
      await this.repository.saveSignedDocumentAndMarkSigned(id, file);
    }

    const serviceJob = await this.serviceJobs.create(
      {
        title: `${order.contract.title} (${order.number})`,
        kind: "MAINTENANCE",
        contractId: order.contract.id,
        customerId: order.contract.customerId,
        departmentId,
        clientOperationId: `maintenance-order-${order.id}-signed`,
      },
      actor,
    );

    for (const item of order.items) {
      await this.worksheets.create(
        {
          customerId: order.contract.customerId,
          departmentId,
          serviceJobId: serviceJob.id,
          subject: item.description,
          clientOperationId: `maintenance-order-${order.id}-worksheet-${item.contractItem.id}`,
          lines: [
            {
              description: item.description,
              quantity: item.quantity.toNumber(),
              unit: "db",
              kind: "OTHER",
            },
          ],
        },
        actor,
      );
    }

    return this.repository.attachServiceJob(id, serviceJob.id);
  }

  /**
   * EGY KARBANTARTÁSI LAP EGY HELYSZÍNRE KÉSZÜL. Ha a bemenet TÖBB
   * különböző helyszínt hordoz, a modell erre még nincs eldöntve (Balázs
   * elé megy) -- ezért megállunk, és a hibaüzenet MEGNEVEZI a helyszíneket
   * (a teljes utat, nem csak a kódot, lásd `unit-path-lookup.ts` fejlécét),
   * hogy ne kelljen találgatni, melyik tétel melyik ágon van.
   */
  private async ensureSingleDepartment(
    departmentIds: readonly string[],
  ): Promise<string> {
    const distinct = [...new Set(departmentIds)];
    if (distinct.length === 1) return distinct[0]!;
    const paths = await this.repository.departmentPaths(distinct);
    const names = distinct.map((id) => paths.get(id)?.join(" / ") ?? id);
    throw new BadRequestException(
      `A kiválasztott tételek különböző helyszínen vannak (${names.join(", ")}), ezért egyelőre nem készíthető belőlük egy karbantartási lap. Állíts ki külön megrendelőlapot helyszínenként.`,
    );
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
}
