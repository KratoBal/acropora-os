import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import type {
  CompletionCertificateDocumentSummary,
  CompletionCertificatePartnerDetail,
  CompletionCertificatePartnerItem,
  CompletionCertificatePartnerListResponse,
  CompletionCertificatePartnerSummary,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { serviceJobVisibilityWhere } from "../service-jobs/service-job-visibility.js";

import {
  CompletionCertificatesRepository,
  type PortalCompletionCertificateRow,
} from "./completion-certificates.repository.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

/** A ma ténylegesen előálló EGYETLEN tartalomtípus -- mindkét dokumentum PDF. */
function documentedCertificateContentType(
  contentType: string,
): CompletionCertificateDocumentSummary["contentType"] {
  if (contentType === "application/pdf") return contentType;
  throw new Error(
    `Nem támogatott tárolt teljesítésiigazolás-dokumentumtípus: ${contentType}`,
  );
}

/**
 * A TELJESÍTÉSI IGAZOLÁS OLVASÁSA/FELTÖLTÉSE A PARTNER PORTÁLON.
 *
 * UGYANAZ A SZERKEZETI DÖNTÉS, MINT A `MaintenanceOrdersPortalService`-nél
 * (lásd annak fejlécét): a listázás/adatlap/letöltés a saját, ár nélküli
 * `portalCertificateSelect`-tel dolgozik, az aláírt példány feltöltése a
 * MEGLÉVŐ `CompletionCertificatesService.uploadSignedDocument()`-et hívja,
 * a láthatóság és a `COMPLETION_CERTIFICATE_UPLOAD_SIGNED` képesség
 * ellenőrzése UTÁN. A `PARTNERS_MANAGE`-es belső végpontok innen NEM
 * érhetők el.
 *
 * A LÁTHATÓSÁG ITT EGYSZERŰBB, MINT A MEGRENDELŐLAPNÁL: a
 * `CompletionCertificate.serviceJob` EGY közvetlen, kötelező kapcsolat egy
 * ADOTT `ServiceJob` sorra (nem tételek gyűjteménye, mint a megrendelőlap
 * helyszíne), tehát a MEGLÉVŐ `serviceJobVisibilityWhere` közvetlenül
 * újrahasznosítható -- lásd `completion-certificates.repository.ts`
 * `portalListForVisibility()` fejlécét arról, miért nem esik ez ugyanabba
 * a hibaosztályba, mint egy relációs `some`-túltágulás.
 */
@Injectable()
export class CompletionCertificatesPortalService {
  constructor(
    private readonly repository: CompletionCertificatesRepository,
    private readonly internalService: CompletionCertificatesService,
  ) {}

  async list(
    user: AuthenticatedUser,
  ): Promise<CompletionCertificatePartnerListResponse> {
    const scope = partnerScopeOf(user);
    if (scope.kind !== "customer") return { items: [] };
    const unitIds = await assignedUnitIdsFor(user.id);
    const rows = await this.repository.portalListForVisibility(
      serviceJobVisibilityWhere({ scope, userId: user.id, unitIds }),
    );
    const departmentNames = await this.departmentNames(rows);
    return { items: rows.map((row) => this.toSummary(row, departmentNames)) };
  }

  async detail(
    id: string,
    user: AuthenticatedUser,
  ): Promise<CompletionCertificatePartnerDetail> {
    const row = await this.visibleRowOrThrow(id, user);
    const departmentNames = await this.departmentNames([row]);
    const canUploadSigned = await this.repository.hasUploadSignedCapability(
      user.id,
    );
    const items: CompletionCertificatePartnerItem[] = row.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity.toString(),
    }));
    const documents: CompletionCertificateDocumentSummary[] = row.documents.map(
      (document) => ({
        id: document.id,
        type: document.type,
        fileName: document.fileName,
        contentType: documentedCertificateContentType(document.contentType),
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt.toISOString(),
      }),
    );
    return {
      ...this.toSummary(row, departmentNames),
      items,
      documents,
      canUploadSigned,
    };
  }

  async document(
    certificateId: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    await this.visibleRowOrThrow(certificateId, user);
    return this.internalService.document(certificateId, documentId);
  }

  /**
   * A VÁLASZ SZÁNDÉKOSAN `{ ok: true }`, NEM A BELSŐ SZOLGÁLTATÁS
   * VISSZATÉRÉSE -- ugyanaz az elővigyázatosság, mint a
   * `MaintenanceOrdersPortalService`-nél (lásd annak fejlécét). Ma a
   * `CompletionCertificatesService.uploadSignedDocument()` válasza (`addSignedDocument`
   * select-je) NEM hordoz árat, de a portál válaszát nem szeretnénk attól
   * függővé tenni, hogy ez a belső select a jövőben is így marad.
   */
  async uploadSignedDocument(
    certificateId: string,
    file: Express.Multer.File,
    user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.visibleRowOrThrow(certificateId, user);
    const allowed = await this.repository.hasUploadSignedCapability(user.id);
    if (!allowed)
      throw new ForbiddenException(
        "Nincs bejelölve nálad az aláírt teljesítési igazolás feltöltésének joga.",
      );
    await this.internalService.uploadSignedDocument(certificateId, file);
    return { ok: true };
  }

  private async visibleRowOrThrow(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PortalCompletionCertificateRow> {
    const scope = partnerScopeOf(user);
    if (scope.kind !== "customer")
      throw new NotFoundException("A teljesítési igazolás nem található.");
    const unitIds = await assignedUnitIdsFor(user.id);
    const row = await this.repository.portalDetail(
      id,
      serviceJobVisibilityWhere({ scope, userId: user.id, unitIds }),
    );
    if (!row)
      throw new NotFoundException("A teljesítési igazolás nem található.");
    return row;
  }

  private async departmentNames(
    rows: readonly PortalCompletionCertificateRow[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.serviceJob.departmentId))];
    return this.repository.departmentNames(ids);
  }

  private toSummary(
    row: PortalCompletionCertificateRow,
    departmentNames: Map<string, string>,
  ): CompletionCertificatePartnerSummary {
    return {
      id: row.id,
      number: row.number,
      issuedAt: row.issuedAt.toISOString(),
      issuedByName: row.issuedByName,
      departmentName: departmentNames.get(row.serviceJob.departmentId) ?? "—",
      hasSignedDocument: row.documents.some(
        (document) => document.type === "SIGNED_FORM",
      ),
    };
  }
}
