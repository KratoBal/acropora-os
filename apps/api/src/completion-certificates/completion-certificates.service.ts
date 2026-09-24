import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";

import { completionCertificateDocument } from "./completion-certificate-document.js";
import {
  completionCertificateNumberPrefix,
  nextCompletionCertificateNumber,
} from "./completion-certificate-number.js";
import type { CompletionCertificateInput } from "./completion-certificate-types.js";
import { IssueCompletionCertificateDto } from "./dto.js";
import { CompletionCertificatesRepository } from "./completion-certificates.repository.js";

/**
 * A KIÁLLÍTÁS ÉVE, BUDAPESTI NAPTÁR SZERINT -- UGYANAZ AZ INDOK, MINT A
 * `maintenance-order-occasion-year.ts`-nél: egy UTC-alapú `getFullYear()`
 * december 31-i késő esti kiállításnál a MEGELŐZŐ évet mondaná, és a
 * sorszám-évet tolná el egy nappal korábbra a valódinál.
 */
const HU_YEAR = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  timeZone: "Europe/Budapest",
});
function budapestYear(date: Date): number {
  return Number(HU_YEAR.format(date));
}

@Injectable()
export class CompletionCertificatesService {
  constructor(private readonly repository: CompletionCertificatesRepository) {}

  list(serviceJobId: string) {
    return this.repository.list(serviceJobId);
  }

  async detail(id: string) {
    const certificate = await this.repository.detail(id);
    if (!certificate)
      throw new NotFoundException("A teljesítési igazolás nem található.");
    return certificate;
  }

  async document(certificateId: string, documentId: string) {
    const document = await this.repository.document(certificateId, documentId);
    if (!document || !document.content)
      throw new NotFoundException("A dokumentum nem található.");
    return { ...document, bytes: document.content };
  }

  /**
   * A KIÁLLÍTÁS: ELLENŐRZÉS, PDF, TÁROLÁS -- EBBEN A SORRENDBEN, UGYANÚGY,
   * MINT A MEGRENDELŐLAPNÁL.
   *
   * A TÉTELEK FORRÁSA A MEGRENDELŐLAP, NEM A SZERZŐDÉS KÖZVETLENÜL: a
   * `MaintenanceOrderItem` már a KIÁLLÍTÁS pillanatának másolata (lásd ott a
   * modell fejlécét), tehát ha a szerződéses ár azóta változott, ez az
   * igazolás a RÉGI, akkor érvényes árat mutatja -- ugyanazt, amit a
   * megrendelőlap is mutatott.
   */
  async issue(dto: IssueCompletionCertificateDto, actor: AuthenticatedUser) {
    const job = await this.repository.serviceJobForIssuance(dto.serviceJobId);
    if (!job) throw new NotFoundException("A karbantartási lap nem található.");
    if (job.kind !== "MAINTENANCE")
      throw new BadRequestException(
        "Csak karbantartási lapra állítható ki teljesítési igazolás.",
      );
    if (job.completionCertificate)
      throw new ConflictException(
        "Ehhez a laphoz már készült teljesítési igazolás.",
      );
    if (!job.maintenanceOrder)
      throw new BadRequestException(
        "Ehhez a laphoz nem tartozik megrendelőlap, a tételek forrása ismeretlen.",
      );
    if (!job.maintenanceOrder.items.length)
      throw new BadRequestException("A megrendelőlapnak nincs tétele.");

    /*
      "AZ ALÁÍRT MUNKALAPOKBÓL" -- ez a szófordulat feltétel, nem csak
      leírás. Ha bármelyik munkalap nem jutott el az ALÁÍRVA állapotig, az
      igazolás olyan munkát igazolna, amit a vevő még nem fogadott el.
    */
    const alairatlan = job.worksheets.filter(
      (worksheet) => worksheet.versions[0]?.status !== "SIGNED",
    );
    if (alairatlan.length)
      throw new ConflictException(
        `Nem minden munkalap van aláírva ehhez a laphoz (${alairatlan.length} db még nem az), teljesítési igazolás nem állítható ki.`,
      );

    const now = new Date();
    const maintenanceOrder = job.maintenanceOrder;
    const address = job.customer?.addresses[0] ?? null;
    const firstWorksheet = job.worksheets[0] ?? null;

    const input: CompletionCertificateInput = {
      certificateNumber: "",
      issuedAt: now,
      completedAt: job.completedAt ?? now,
      subject: job.title,
      worksheetReference: firstWorksheet?.number
        ? `Munkalap ${firstWorksheet.number}`
        : undefined,
      customer: {
        name: job.customer?.displayName ?? "",
        addressLines: address
          ? [address.line1, `${address.postalCode} ${address.city}`]
          : [],
        taxNumber: job.customer?.taxNumber ?? undefined,
      },
      items: maintenanceOrder.items.map((item) => ({
        description: item.description,
        contractNumber: maintenanceOrder.contract.number,
        // EGY MEGRENDELŐLAP-TÉTEL EGY ALKALMAT VISZ (lásd
        // `MaintenanceOrdersService.issue`) -- a teljesítési igazolás
        // ugyanazt az egy alkalmat igazolja, nem a szerződés éves keretét.
        quantity: 1,
        quantityUnit: "alkalom",
        unitPrice: item.unitNet,
        vatRatePercent: item.vatRatePercent,
      })),
      signerName: actor.displayName,
      signerEmail: actor.email,
    };

    const last = await this.repository.lastNumberOfYear(
      completionCertificateNumberPrefix(budapestYear(now)),
    );
    const number = nextCompletionCertificateNumber({
      year: budapestYear(now),
      lastNumber: last,
    });
    input.certificateNumber = number;

    const content = await completionCertificateDocument(input);
    const kind = detectUploadedFileKind("application/pdf", content);
    if (kind === null)
      throw new Error(
        "A generált teljesítési igazolás nem érvényes PDF. A kiállítás nem jött létre, mert épp ezt neveznénk hitelesnek.",
      );

    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      const quota = decideQuota({
        usedBytes: await sumDocumentBytesInUse(),
        incomingBytes: content.length,
        limitBytes,
      });
      if (quota.state === "reject") throw new ConflictException(quota.reason);
    }

    try {
      return await this.repository.issue({
        serviceJobId: job.id,
        number,
        issuedByName: actor.displayName,
        items: maintenanceOrder.items.map((item) => ({
          description: item.description,
          // EGY ALKALOM -- lásd a `CompletionCertificateInput` építésénél a
          // magyarázatot ugyanerre a döntésre.
          quantity: new Prisma.Decimal(1),
          unitNet: item.unitNet,
          vatRatePercent: item.vatRatePercent,
        })),
        document: {
          fileName: `teljesitesi-igazolas-${number}.pdf`,
          contentType: canonicalMimetypeFor(kind),
          sizeBytes: content.length,
          content,
        },
      });
    } catch (error) {
      /*
        UGYANAZ A MINTA, MINT A MEGRENDELŐLAPNÁL (`maintenance-orders.service.ts`):
        a szám itt sem felhasználói bevitel, hanem a
        `nextCompletionCertificateNumber` által számolt sorban következő
        érték -- a P2002 versenyhelyzetet jelent, nem elgépelést. Az
        `serviceJobId @unique`-et fentebb, alkalmazás-szinten már
        ellenőriztük (79. sor), tehát ide gyakorlatilag csak a szám-ütközés
        juthat el; egy újrapróbálás akkor is a helyes hibát adná, ha mégsem.
      */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          `A(z) ${number} teljesítési igazolás száma időközben már kiosztásra került. Próbáld újra.`,
        );
      throw error;
    }
  }

  async uploadSignedDocument(id: string, file: Express.Multer.File) {
    await this.detail(id);
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
    return this.repository.addSignedDocument(id, file);
  }
}
