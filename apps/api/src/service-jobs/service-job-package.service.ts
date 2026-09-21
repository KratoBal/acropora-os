import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";

import { partnerStatusLabel } from "./service-job-status.js";
import { serviceJobVisibilityFor } from "./service-job-visibility-scope.js";
import { serviceJobSheetDocument } from "./service-job-sheet-document.js";
import {
  serviceJobPackageFileName,
  serviceJobPackageZip,
} from "./service-job-package-zip.js";
import { ServiceJobPackageRepository } from "./service-job-package.repository.js";

export interface ServiceJobPackage {
  fileName: string;
  bytes: Buffer;
}

@Injectable()
export class ServiceJobPackageService {
  constructor(
    private readonly repository: ServiceJobPackageRepository,
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

  async download(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobPackage> {
    const scope = partnerScopeOf(user);
    const visibility = await serviceJobVisibilityFor(user, (userId) =>
      this.repository.assignedUnitIds(userId),
    );
    const job = await this.repository.packageData(id, visibility);
    if (!job) throw new NotFoundException("A hibajegy nem található.");
    if (job.status !== "COMPLETED")
      throw new BadRequestException(
        "Dokumentumcsomag csak elkészült hibajegyhez tölthető le.",
      );

    const completedEvent = [...job.events]
      .reverse()
      .find((event) => event.toStatus === "COMPLETED");
    if (!completedEvent)
      throw new ServiceUnavailableException(
        "A hibajegy elkészülési időpontja nem érhető el, ezért a dokumentumcsomag nem állítható elő.",
      );

    const jobPdf = await serviceJobSheetDocument({
      jobNumber: job.jobNumber,
      status: job.status,
      customerName: job.customer?.displayName ?? null,
      departmentPath: job.departmentPath,
      title: job.title,
      description: job.description,
      openedAt: job.createdAt,
      closedAt: completedEvent.createdAt,
      assets: job.assets.map(({ asset }) => ({
        assetNumber: asset.assetNumber,
        assetName: asset.name,
      })),
      assignees: job.assignees.map(({ user }) => user.displayName),
      photos: (job.documents ?? []).flatMap((document) =>
        document.thumbnail
          ? [{ thumbnail: document.thumbnail, caption: document.caption }]
          : [],
      ),
      log: [
        { at: job.createdAt, text: "Hibajegy megnyitva.", authorName: null },
        ...job.events.map((event) => ({
          at: event.createdAt,
          text: `Állapot módosítva: ${event.toStatus ? partnerStatusLabel(event.toStatus) : "nincs megadva"}${event.note ? ` — ${event.note}` : ""}`,
          authorName: event.actor?.displayName ?? null,
        })),
      ],
    });
    const entries: { name: string; bytes: Uint8Array }[] = [
      { name: `hibajegy-${job.jobNumber}.pdf`, bytes: jobPdf },
    ];

    for (const worksheet of job.worksheets) {
      if (scope.kind !== "internal" && worksheet.hiddenAt !== null) continue;
      const currentVersionId = worksheet.versions[0]?.id;
      const document = worksheet.documents.find(
        (candidate) => candidate.worksheetVersionId === currentVersionId,
      );
      if (!document) continue;
      entries.push({
        name: document.fileName,
        bytes: await this.worksheetBytes(worksheet.id, document),
      });
    }

    return {
      fileName: serviceJobPackageFileName(job.jobNumber),
      bytes: serviceJobPackageZip(entries),
    };
  }
}
