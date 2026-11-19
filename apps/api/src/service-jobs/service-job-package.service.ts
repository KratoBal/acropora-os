import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  personLegalName,
  preferSignedSheet,
  type AuthenticatedUser,
  type WorksheetDocumentType,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { worksheetUnitWhere } from "../worksheets/worksheet-unit-scope.js";
import {
  worksheetsBlockingPackage,
  type BlockingPackageWorksheet,
  type PackageBlockReason,
  type PackageWorksheetState,
} from "../common/worksheet-signature-gate.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";

import { jegyNaploSora } from "./service-job-package-log.js";
import { serviceJobVisibilityFor } from "./service-job-visibility-scope.js";
import { serviceJobSheetDocument } from "./service-job-sheet-document.js";
import { visibleLinkedWorksheets } from "./service-job-sheet-content.js";
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

  /**
   * THE ISSUED SHEET OF A WORKSHEET'S CURRENT VERSION, or `null` (hidden for a partner, or none issued). One place for the
   * own and the linked worksheets: a rule that read the two sets differently would let a draft-marked sheet into one of them.
   *
   * ONE VERSION CAN HAVE TWO SHEETS (since 2026-09-21), and the FINAL one goes in: no draft label on it, and the signature
   * stands on it. `preferSignedSheet` chooses by TYPE, not by creation time.
   */
  private issuedSheetOf(
    worksheet: {
      hiddenAt: Date | null;
      versions: { id: string }[];
      documents: {
        id: string;
        worksheetVersionId: string | null;
        type: WorksheetDocumentType;
        fileName: string;
        content: Uint8Array | null;
        storageKey: string | null;
      }[];
    },
    internal: boolean,
  ) {
    if (!internal && worksheet.hiddenAt !== null) return null;
    const currentVersionId = worksheet.versions[0]?.id;
    return preferSignedSheet(
      worksheet.documents.filter(
        (candidate) => candidate.worksheetVersionId === currentVersionId,
      ),
    );
  }

  async download(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobPackage> {
    const scope = partnerScopeOf(user);
    const visibility = await serviceJobVisibilityFor(user, (userId) =>
      this.repository.assignedUnitIds(userId),
    );
    // The linked worksheets follow the same unit rule as the worksheet list and PDF (#2749): a restricted partner's package
    // never carries a worksheet of another unit. Internal users are not narrowed.
    const unitIds =
      scope.kind === "customer"
        ? await this.repository.assignedUnitIds(user.id)
        : [];
    const job = await this.repository.packageData(
      id,
      visibility,
      worksheetUnitWhere(scope, unitIds),
    );
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

    // A linked worksheet the viewer may not see (hidden, for a partner) is neither listed nor counted
    const linked =
      job.kind === "MAINTENANCE"
        ? visibleLinkedWorksheets(
            job.linkedWorksheets ?? [],
            scope.kind === "internal",
          )
        : undefined;

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
      assignees: job.assignees.map(({ user }) => personLegalName(user)),
      // `undefined` for a repair ticket (no section); for a maintenance sheet the list, possibly empty
      linkedWorksheets: linked
        ? linked.map(({ worksheet }) => ({
            number: worksheet.number,
            subject: worksheet.versions[0]?.subject ?? "",
            createdAt: worksheet.createdAt,
          }))
        : undefined,
      photos: (job.documents ?? []).flatMap((document) =>
        document.thumbnail
          ? [{ thumbnail: document.thumbnail, caption: document.caption }]
          : [],
      ),
      log: [
        { at: job.createdAt, text: "Hibajegy megnyitva.", authorName: null },
        /*
          A MEGJEGYZES CSAK A BELSO CSOMAGBA KERUL (Balazs, 2026-09-21). A
          kulonbseget PARAMETER valasztja szet, nem az, hogy melyik hivo
          felejti el -- reszletek a `service-job-package-log.ts` fejleceben.
        */
        ...job.events.map((event) =>
          jegyNaploSora({
            at: event.createdAt,
            toStatus: event.toStatus,
            note: event.note,
            authorName: event.actor ? personLegalName(event.actor) : null,
            belso: scope.kind === "internal",
          }),
        ),
      ],
    });
    /*
      A KAPU A CSOMAG OSSZEALLITASA ELOTT ALL, es ez nem stilus: ha a ciklusban
      allna meg, a PDF-ek egy resze mar eloallt volna feleslegesen.

      ES A SZERVEREN ALL, NEM A GOMBON. Ma egyetlen szerver-ut vezet ide
      (`GET :id/download`), es csak a webes felulet hivja -- de a dontes az
      ATADASROL szol, nem a letoltesrol. Egy gomb-szintu tiltas a telefont es a
      partnerportalt valtozatlanul hagyna, amint azok is ideernek.
    */
    const visszatarto = worksheetsBlockingPackage({
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
      scope: scope.kind === "internal" ? "internal" : "partner",
    });
    if (visszatarto.length)
      throw new BadRequestException(csomagHiba(visszatarto));
    /*
      A HIVATKOZOTT MUNKALAPOKRA UGYANAZ A KAPU ALL (card 5b366f5d, acrobot): a csomagba a kiadott PDF-jük kerul, tehat egy
      lezaratlan vagy kiadott peldany nelkuli hivatkozott lap ugyanugy visszatartja, mint a sajat munkalap. A MONDAT MAS, mert a
      teendo mas: a hivatkozott lap nem ide tartozik, tehat nem "vedd le a hibajegyrol", hanem "zard le, vagy vedd le a
      kapcsolatot".
    */
    const linkedBlocking = worksheetsBlockingPackage({
      worksheets: (linked ?? []).map(({ worksheet }) => ({
        id: worksheet.id,
        number: worksheet.number,
        hidden: worksheet.hiddenAt !== null,
        closed: worksheet.versions[0]?.closedAt != null,
        hasIssuedSheet: worksheet.documents.some(
          (document) =>
            document.worksheetVersionId === worksheet.versions[0]?.id,
        ),
      })),
      scope: scope.kind === "internal" ? "internal" : "partner",
    });
    if (linkedBlocking.length)
      throw new BadRequestException(csomagHiba(linkedBlocking, true));

    const entries: { name: string; bytes: Uint8Array }[] = [
      { name: `hibajegy-${job.jobNumber}.pdf`, bytes: jobPdf },
    ];

    for (const worksheet of job.worksheets) {
      const document = this.issuedSheetOf(worksheet, scope.kind === "internal");
      if (!document) continue;
      entries.push({
        name: document.fileName,
        bytes: await this.worksheetBytes(worksheet.id, document),
      });
    }
    /*
      A HIVATKOZOTT MUNKALAPOK KIADOTT PDF-JE (a bejegyzesekkel es a fotokkal egyutt, mert a kiadott lap azokat mar
      tartalmazza), `kapcsolodo-` elotaggal: a csomagban latszik, hogy hivatkozas, es egy hivatkozott lap fajlneve nem utkozhet
      a sajat munkalapok nevevel. Munkaora es ar sehol: a PDF a munkalap sajat lapja, a lap osszegeibe nem szamit bele.
    */
    for (const { worksheet } of linked ?? []) {
      const document = this.issuedSheetOf(worksheet, scope.kind === "internal");
      if (!document) continue;
      entries.push({
        name: `kapcsolodo-${document.fileName}`,
        bytes: await this.worksheetBytes(worksheet.id, document),
      });
    }

    return {
      fileName: serviceJobPackageFileName(job.jobNumber),
      bytes: serviceJobPackageZip(entries),
    };
  }
}

/**
 * A VISSZATARTAS MONDATA -- MIND A KET OK EGY MONDATBAN.
 *
 * Ugyanaz az alak, mint a lezarasi kapunal (#929): ket feltetel ugyanarra a
 * lepesre, es kulon-kulon elmondva a kezelo megjavitja az elsot, visszajon, es
 * a masodikon all meg. Ugyanaz az ut ketszer.
 *
 * A KET OK KULON MONDATOT KAP, mert a TEENDO kulonbozik. A lezaratlan lapot a
 * kezelo le tudja zarni; a kiadott peldany hianyat NEM -- az a lap mar zart,
 * tehat ott nincs mit tennie, es a mondat ezt ki is mondja. Egy kozos „nem
 * adhato at" mondat a masodik esetben olyan teendore kuldene, ami nem letezik.
 */
function csomagHiba(
  visszatarto: readonly BlockingPackageWorksheet[],
  kapcsolodo = false,
): string {
  const nev = (sheet: PackageWorksheetState): string => {
    const alap = sheet.number ?? "szám nélküli munkalap";
    return sheet.hidden ? `${alap} (rejtett)` : alap;
  };
  const nevekAhol = (ok: PackageBlockReason): string =>
    visszatarto
      .filter((tetel) => tetel.reason === ok)
      .map((tetel) => nev(tetel.sheet))
      .join(", ");

  const reszek: string[] = [];
  const lezaratlan = nevekAhol("not-closed");
  if (lezaratlan)
    reszek.push(
      kapcsolodo
        ? `Nincs lezárva: ${lezaratlan}. Zárd le a munkalapot, vagy vedd le a kapcsolatot a karbantartási lapról.`
        : `Nincs lezárva: ${lezaratlan}. Zárd le a lapot, vagy ha nem ide tartozik, vedd le a hibajegyről.`,
    );
  const peldanytalan = nevekAhol("no-issued-sheet");
  if (peldanytalan)
    reszek.push(
      `Le van zárva, de a kiadott munkalap hiányzik: ${peldanytalan}. ` +
        "Ezt lezárással nem lehet pótolni, szólj a fejlesztésnek.",
    );

  return [
    kapcsolodo
      ? "A karbantartási lap dokumentumcsomagja nem adható át, amíg a hozzákapcsolt munkalapjai nincsenek rendben."
      : "A hibajegy dokumentumcsomagja nem adható át, amíg a munkalapjai nincsenek rendben.",
    ...reszek,
  ].join(" ");
}
