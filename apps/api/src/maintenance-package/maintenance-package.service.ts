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
 * teljesítési igazolás, számla. A SZÁMLA MA MINDIG HIÁNYZIK (nincs modell,
 * nincs kiállítás -- 4. szelet), ezért `assemble(..., "send")` MA MINDIG
 * elutasít: ez a helyes, várt állapot, amíg a Számlázz.hu-kulcs meg nem jön.
 *
 * A KAPU RÉSZLETEI A `maintenance-package-gate.ts`-BEN ÁLLNAK, mérhetően.
 */
@Injectable()
export class MaintenancePackageService {
  constructor(
    private readonly repository: MaintenancePackageRepository,
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
        A SZÁMLA MA SOHA NINCS JELEN -- lásd a modul fejlécét. Ez az EGYETLEN
        hely, ami a 4. szelet érkezésekor módosul: egy valódi számla-lekérdezés
        váltja fel a `false`-t.
      */
      invoicePresent: false,
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
      A SZÁMLÁNAK ITT VAN A HELYE A CSOMAGBAN -- egy negyedik `entries.push`,
      amint a 4. szelet előállítja a bájtjait. `purpose === "send"` esetén a
      fenti kapu ma mindig elutasít, mielőtt idáig érne a hívás.
    */

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
