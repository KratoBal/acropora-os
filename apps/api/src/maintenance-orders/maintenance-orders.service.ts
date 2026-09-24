import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

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

    return this.repository.issue({
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
  }

  /**
   * AZ ALÁÍRT PÉLDÁNY VISSZAJÖTT -- TÁROLÁS, MAJD A KARBANTARTÁSI LAP.
   *
   * A karbantartási lap (MAINTENANCE ServiceJob) és a tételenkénti
   * munkalapok a MEGLÉVŐ szolgáltatásokon keresztül jönnek létre
   * (`ServiceJobsService.create`, `WorksheetsService.create`), nem saját
   * repository-hívással -- így minden ellenőrzésük (jegyszám-kiosztás,
   * felelős-érvényesítés, értesítés) egyszer létezik, nem kétszer.
   */
  async uploadSignedDocument(
    id: string,
    file: Express.Multer.File,
    actor: AuthenticatedUser,
  ) {
    const order = await this.detail(id);
    if (order.status !== "ISSUED")
      throw new BadRequestException(
        order.status === "SIGNED"
          ? "Ez a megrendelőlap már alá van írva."
          : "Ez a megrendelőlap vissza lett vonva, aláírt példány nem tölthető fel hozzá.",
      );
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
    await this.repository.addSignedDocument(id, file);

    const serviceJob = await this.serviceJobs.create(
      {
        title: `${order.contract.title} (${order.number})`,
        kind: "MAINTENANCE",
        contractId: order.contract.id,
        customerId: order.contract.customerId,
      },
      actor,
    );

    for (const item of order.items) {
      const departmentId = item.contractItem.departmentId;
      if (!departmentId)
        // NEM VÁRT ÁLLAPOT: a kiállítás ezt már kizárta. Ha mégis előfordul
        // (a szerződés tétele a kiállítás UTÁN vesztette el a helyszínét),
        // hangosan állunk meg -- egy csendben kihagyott tétel egy vevő által
        // aláírt lapról néma hiány lenne.
        throw new ConflictException(
          `A(z) "${item.description}" tételhez időközben megszűnt a helyszín-hozzárendelés, ezért nem hozható létre hozzá munkalap. A szerződés tételét előbb rendezni kell.`,
        );
      await this.worksheets.create(
        {
          customerId: order.contract.customerId,
          departmentId,
          serviceJobId: serviceJob.id,
          subject: item.description,
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

    return this.repository.markSigned(id, serviceJob.id);
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
