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
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
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
      assignees: job.assignees.map(({ user }) => personLegalName(user)),
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

    const entries: { name: string; bytes: Uint8Array }[] = [
      { name: `hibajegy-${job.jobNumber}.pdf`, bytes: jobPdf },
    ];

    for (const worksheet of job.worksheets) {
      if (scope.kind !== "internal" && worksheet.hiddenAt !== null) continue;
      const currentVersionId = worksheet.versions[0]?.id;
      /*
        EGY VERZIOHOZ KET LAP TARTOZHAT (2026-09-21 ota), es a VEGLEGES megy a
        csomagba: azon nincs piszkozat-felirat, es rajta all az alairas.

        A `preferSignedSheet` TIPUSRA valaszt, nem keletkezesi idore. A ketto ma
        ugyanazt adna -- a vegleges kesobb keszul --, de az EGYBEESES: egy
        visszamenoleges potlas, ami a LEZARASKORIT gyartja utolag egy mar alairt
        verziora, a ket szabalyt szetvalasztana, es akkor a piszkozat-feliratos
        lap menne a vevonek.
      */
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
function csomagHiba(visszatarto: readonly BlockingPackageWorksheet[]): string {
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
      `Nincs lezárva: ${lezaratlan}. Zárd le a lapot, vagy ha nem ide tartozik, vedd le a hibajegyről.`,
    );
  const peldanytalan = nevekAhol("no-issued-sheet");
  if (peldanytalan)
    reszek.push(
      `Le van zárva, de a kiadott munkalap hiányzik: ${peldanytalan}. ` +
        "Ezt lezárással nem lehet pótolni, szólj a fejlesztésnek.",
    );

  return [
    "A hibajegy dokumentumcsomagja nem adható át, amíg a munkalapjai nincsenek rendben.",
    ...reszek,
  ].join(" ");
}
