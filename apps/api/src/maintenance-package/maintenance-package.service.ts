import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";

import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { preferSignedSheet } from "@acropora/types";

import {
  serviceJobPackageZip,
  type ZipEntry,
} from "../service-jobs/service-job-package-zip.js";
import { MaintenanceInvoiceDraftService } from "../maintenance-invoice/maintenance-invoice-draft.service.js";

import {
  maintenancePackageBlockers,
  maintenancePackageBlockMessage,
  maintenancePackageIsBlocked,
} from "./maintenance-package-gate.js";
import { MaintenancePackageRepository } from "./maintenance-package.repository.js";

export interface MaintenancePackage {
  fileName: string;
  bytes: Buffer;
}

/**
 * A KARBANTARTÁSI LAP DOKUMENTUMCSOMAGJA -- A HIBAJEGYES MINTA ÁTVÉTELE
 * (`ServiceJobPackageService`), NÉGY ELEMMEL: megrendelőlap, munkalapok,
 * teljesítési igazolás, számla.
 *
 * A NEGYEDIK ELEM MA A GYAKORLATBAN SOHA NEM KERÜL BELE: a `maintenance-
 * invoice` modul (4. szelet) tud PISZKOZATOT (DRAFT) létrehozni, de VALÓDI
 * kiállítást (ISSUED) még nem -- lásd `MAINTENANCE_INVOICE_ISSUE_ENABLED`
 * a `maintenance-invoice-draft.service.ts` fejlécében. Az `invoicePresent`
 * (`maintenance-package-gate.ts`) emiatt ma mindig hamisra fut ki, tehát
 * `assemble(..., "send")` mindig elutasít -- ez a helyes, várt állapot,
 * amíg a valódi kiállítás meg nem épül. Az alábbi kód ETTŐL FÜGGETLENÜL
 * teljes: ha egyszer lesz ISSUED számla, a negyedik elem AZONNAL bekerül a
 * csomagba, kód nélkül újra kellene nyúlni ehhez a függvényhez.
 *
 * A KAPU RÉSZLETEI A `maintenance-package-gate.ts`-BEN ÁLLNAK, mérhetően.
 */
@Injectable()
export class MaintenancePackageService {
  constructor(
    private readonly repository: MaintenancePackageRepository,
    private readonly invoices: MaintenanceInvoiceDraftService,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  private async worksheetBytes(
    worksheetId: string,
    document: {
      id: string;
      content: Uint8Array | null;
      storageKey: string | null;
    },
  ): Promise<Buffer> {
    if (document.content) return Buffer.from(document.content);
    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );
    if (!document.storageKey)
      throw new ServiceUnavailableException(
        "A munkalap PDF-je egyik tárolási forrásban sem érhető el.",
      );
    const key = {
      owner: "worksheet" as const,
      ownerId: worksheetId,
      documentId: document.id,
    };
    assertStorageKeyMatches(document.storageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new ServiceUnavailableException(
        "A munkalap PDF-je a dokumentum-tárolóban nem érhető el.",
      );
    return Buffer.from(bytes);
  }

  /**
   * A MEGRENDELŐLAP ÉS AZ IGAZOLÁS BÁJTJAI MINDIG A SORON ÁLLNAK -- ezek a
   * két dokumentum-tábla sosem használ `storageKey`-t (mérve: egyetlen író
   * sem hoz létre ilyen sort tárolási kulccsal, csak `content`-tel), tehát
   * itt nincs szükség a munkalapéhoz hasonló tartalék-útra. Ha ez valaha
   * megváltozik, ez a függvény hangosan áll meg, nem csendben ad üreset.
   */
  private inlineBytes(
    document: { content: Uint8Array | null } | null | undefined,
    missingMessage: string,
  ): Buffer {
    if (!document?.content)
      throw new ServiceUnavailableException(missingMessage);
    return Buffer.from(document.content);
  }

  async assemble(
    id: string,
    purpose: "download" | "send",
  ): Promise<MaintenancePackage> {
    const job = await this.repository.packageData(id);
    if (!job) throw new NotFoundException("A karbantartási lap nem található.");

    const certificateDocument = job.completionCertificate?.documents[0] ?? null;
    const issuedInvoice = job.completionCertificate?.invoices[0] ?? null;

    const blockers = maintenancePackageBlockers({
      worksheets: job.worksheets.map((worksheet) => ({
        id: worksheet.id,
        number: worksheet.number,
        hidden: worksheet.hiddenAt !== null,
        closed: worksheet.versions[0]?.closedAt != null,
        hasIssuedSheet: worksheet.documents.some(
          (document) =>
            document.worksheetVersionId === worksheet.versions[0]?.id,
        ),
      })),
      hasCertificate: job.completionCertificate != null,
      certificateSigned: certificateDocument != null,
      /*
        CSAK A VALÓDI KIÁLLÍTÁS ELÉGÍTI KI -- a `maintenance-invoice` modul
        (4. szelet) MA csak DRAFT (előnézeti) piszkozatot tud létrehozni, a
        valódi kiállítás gomb/kapcsoló (`MAINTENANCE_INVOICE_ISSUE_ENABLED`)
        még nem épült meg. Ezért a küldés MA IS mindig elutasít -- ugyanaz a
        megfigyelhető viselkedés, mint a korábbi beégetett `false`-nál, de
        immár a SÉMÁBÓL következik, nem egy TODO-jegyzetből.
      */
      invoicePresent: issuedInvoice != null,
      purpose,
    });
    if (maintenancePackageIsBlocked(blockers))
      throw new BadRequestException(maintenancePackageBlockMessage(blockers));

    const entries: ZipEntry[] = [];

    const orderDocument = job.maintenanceOrder?.documents[0] ?? null;
    entries.push({
      name: orderDocument?.fileName ?? "megrendelolap.pdf",
      bytes: this.inlineBytes(
        orderDocument,
        "A megrendelőlap aláírt PDF-je nem érhető el, holott a karbantartási lap ebből jött létre.",
      ),
    });

    for (const worksheet of job.worksheets) {
      if (worksheet.hiddenAt !== null) continue;
      const currentVersionId = worksheet.versions[0]?.id;
      const document = preferSignedSheet(
        worksheet.documents.filter(
          (candidate) => candidate.worksheetVersionId === currentVersionId,
        ),
      );
      if (!document) continue;
      entries.push({
        name: document.fileName,
        bytes: await this.worksheetBytes(worksheet.id, document),
      });
    }

    entries.push({
      name: certificateDocument?.fileName ?? "teljesitesi-igazolas.pdf",
      bytes: this.inlineBytes(
        certificateDocument,
        "A teljesítési igazolás aláírt PDF-je nem érhető el.",
      ),
    });

    /*
      A NEGYEDIK ELEM: A SZÁMLA. Ma a gyakorlatban SOHA nem fut le --
      `issuedInvoice` csak akkor nem `null`, ha van ISSUED státuszú számla,
      és a fenti kapu ilyenkor engedi csak tovább a hívást -- de amíg a
      valódi kiállítás nincs megépítve (lásd a modul fejlécét), ISSUED
      számla soha nem jöhet létre. A `pdfFor` UGYANAZT a bájtforrást adja,
      amit a piszkozat-előnézet is használ (`maintenance-invoice-draft.
      service.ts`): ha a valódi kiállítás egyszer a MEGLÉVŐ sor PDF-jét
      cseréli le a végleges tartalomra, ez a hívás változtatás nélkül a
      helyeset adja.
    */
    if (issuedInvoice) {
      const bytes = await this.invoices.pdfFor(issuedInvoice.id);
      entries.push({
        name: issuedInvoice.invoiceNumber
          ? `szamla-${issuedInvoice.invoiceNumber}.pdf`
          : "szamla.pdf",
        bytes,
      });
    }

    return {
      fileName: maintenancePackageFileName(job.jobNumber),
      bytes: serviceJobPackageZip(entries),
    };
  }
}

function maintenancePackageFileName(jobNumber: string): string {
  const clean = jobNumber
    .normalize("NFKC")
    .replace(/[\\/\p{Cc}\p{Cf}]/gu, "-")
    .trim()
    .slice(0, 120);
  return `${clean || "karbantartas"}-dokumentumcsomag.zip`;
}
