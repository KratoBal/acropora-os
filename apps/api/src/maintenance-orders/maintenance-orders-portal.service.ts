import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";
import type {
  MaintenanceOrderDocumentSummary,
  MaintenanceOrderPartnerDetail,
  MaintenanceOrderPartnerItem,
  MaintenanceOrderPartnerListResponse,
  MaintenanceOrderPartnerSummary,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";

import {
  customerFullyCoveredByUnits,
  maintenanceOrderLocationView,
  maintenanceOrderVisibleToScope,
} from "./maintenance-order-visibility.js";
import {
  MaintenanceOrdersRepository,
  type PortalMaintenanceOrderRow,
} from "./maintenance-orders.repository.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

const HU_MONTH_YEAR = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "long",
  timeZone: "Europe/Budapest",
});

/** A ma ténylegesen előálló két tartalomtípus -- lásd `@acropora/types` `MaintenanceOrderDocumentContentType` fejlécét. */
function documentedMaintenanceOrderContentType(
  contentType: string,
): MaintenanceOrderDocumentSummary["contentType"] {
  if (
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType === "application/pdf"
  )
    return contentType;
  throw new Error(
    `Nem támogatott tárolt megrendelőlap-dokumentumtípus: ${contentType}`,
  );
}

/**
 * A MEGRENDELŐLAP OLVASÁSA/FELTÖLTÉSE A PARTNER PORTÁLON.
 *
 * === EZ NEM A BELSŐ `MaintenanceOrdersController`/`MaintenanceOrdersService`
 *     MÁSODIK BEJÁRATA, HANEM EGY ÚJ, SZŰK RÉTEG A MEGLÉVŐ SZOLGÁLTATÁS
 *     ELŐTT ===
 *
 * A LISTÁZÁS/ADATLAP/LETÖLTÉS a SAJÁT, ár nélküli `portalOrderSelect`-tel
 * dolgozik (lásd `maintenance-orders.repository.ts`), és a láthatóságot
 * (melyik rendelést látja a hívó) ITT, ebben a rétegben dönti el --
 * lásd `maintenance-order-visibility.ts`.
 *
 * AZ ALÁÍRT PÉLDÁNY FELTÖLTÉSE VISZONT A MEGLÉVŐ
 * `MaintenanceOrdersService.uploadSignedDocument()`-et HÍVJA, miután ez a
 * réteg a láthatóságot ÉS a felhasználónkénti `MAINTENANCE_ORDER_
 * UPLOAD_SIGNED` képességet ellenőrizte. Ennek az az oka, hogy az a metódus
 * NEM csak egy fájlt ment: a `SIGNED` állapotváltás UTÁN idempotensen
 * létrehozza a karbantartási lapot (`ServiceJob`) és a hozzá tartozó
 * munkalapokat (`Worksheet`) is (lásd a saját fejlécét) -- ezt a
 * folyamatot EGY HELYEN kell tartani, mert egy másolat elkerülhetetlenül
 * elcsúszna tőle (pl. a jövőbeli idempotencia-kulcs vagy a kvóta-ellenőrzés
 * változásánál). A `PARTNERS_MANAGE`-es belső VÉGPONT (`POST /partners/
 * maintenance-orders/:id/signed-document`) emiatt NEM nyílik meg a portál
 * felé -- csak a mögötte álló szolgáltatás-metódust hívjuk, szerver-
 * oldalról, saját jogosultság-ellenőrzés UTÁN.
 */
@Injectable()
export class MaintenanceOrdersPortalService {
  constructor(
    private readonly repository: MaintenanceOrdersRepository,
    private readonly internalService: MaintenanceOrdersService,
  ) {}

  async list(
    user: AuthenticatedUser,
  ): Promise<MaintenanceOrderPartnerListResponse> {
    const scope = partnerScopeOf(user);
    /*
      CSAK VEVŐ-HATÓKÖRŰ HÍVÓT SZOLGÁL KI. A belsős és a szállító-hatókörű
      hívó ide sosem ér el a mai portál-felületről (a `PARTNER_SERVICE`
      szerep mindig vevőhöz kötött), és egy üres válasz itt biztonságosabb,
      mint egy `{}` (mindent enged) ág -- ugyanaz a döntés, mint az
      `aquariumVisibilityWhere` szállító-ágánál.
    */
    if (scope.kind !== "customer") return { items: [] };
    const [rows, unitIds] = await Promise.all([
      this.repository.portalListForCustomer(scope.customerId),
      assignedUnitIdsFor(user.id),
    ]);
    const visible = await this.filterVisible(rows, scope.customerId, unitIds);
    const departmentNames = await this.departmentNames(visible);
    return {
      items: visible.map((row) => this.toSummary(row, departmentNames)),
    };
  }

  async detail(
    id: string,
    user: AuthenticatedUser,
  ): Promise<MaintenanceOrderPartnerDetail> {
    const row = await this.visibleRowOrThrow(id, user);
    const departmentNames = await this.departmentNames([row]);
    const canUploadSigned = await this.repository.hasUploadSignedCapability(
      user.id,
    );
    const items: MaintenanceOrderPartnerItem[] = row.items
      .slice()
      .sort((a, b) => a.contractItem.position - b.contractItem.position)
      .map((item) => ({
        id: item.id,
        position: item.contractItem.position,
        description: item.description,
        quantity: item.quantity.toString(),
        unit: "alkalom",
      }));
    const documents: MaintenanceOrderDocumentSummary[] = row.documents.map(
      (document) => ({
        id: document.id,
        type: document.type,
        fileName: document.fileName,
        contentType: documentedMaintenanceOrderContentType(
          document.contentType,
        ),
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

  async document(orderId: string, documentId: string, user: AuthenticatedUser) {
    await this.visibleRowOrThrow(orderId, user);
    return this.internalService.document(orderId, documentId);
  }

  /**
   * A VÁLASZ SZÁNDÉKOSAN NEM A BELSŐ SZOLGÁLTATÁS VISSZATÉRÉSE.
   *
   * `MaintenanceOrdersService.uploadSignedDocument()` a teljes, ÁR-HORDOZÓ
   * belső sort adja vissza (`attachServiceJob()` az `orderInclude`-dal
   * dolgozik, ami `unitNet`/`vatRatePercent`-et is hoz). Ha ezt a portál
   * felé egyenesen visszaadnánk, a feltöltés válasza -- a felület nem is
   * használja, de a HTTP-válasz teste igen -- pontosan azt az árat
   * szivárogtatná ki, amit a lista/adatlap select-je szándékosan kizár.
   * A hívó ezért `{ ok: true }`-t kap, a felület a saját `load()`-ját hívja
   * a friss, ár nélküli adatlapért (lásd `maintenance-order-detail.tsx`).
   */
  async uploadSignedDocument(
    orderId: string,
    file: Express.Multer.File,
    user: AuthenticatedUser,
  ): Promise<{ ok: true }> {
    await this.visibleRowOrThrow(orderId, user);
    const allowed = await this.repository.hasUploadSignedCapability(user.id);
    if (!allowed)
      throw new ForbiddenException(
        "Nincs bejelölve nálad az aláírt megrendelőlap feltöltésének joga.",
      );
    await this.internalService.uploadSignedDocument(orderId, file, user);
    return { ok: true };
  }

  /** A LÁTHATÓ SORT ADJA VISSZA, VAGY 404-ET -- egy helyen, minden hívónak. */
  private async visibleRowOrThrow(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PortalMaintenanceOrderRow> {
    const scope = partnerScopeOf(user);
    if (scope.kind !== "customer")
      throw new NotFoundException("A megrendelőlap nem található.");
    const row = await this.repository.portalDetail(id, scope.customerId);
    if (!row) throw new NotFoundException("A megrendelőlap nem található.");
    const unitIds = await assignedUnitIdsFor(user.id);
    const [visible] = await this.filterVisible(
      [row],
      scope.customerId,
      unitIds,
    );
    if (!visible) throw new NotFoundException("A megrendelőlap nem található.");
    return visible;
  }

  /**
   * A SOROK, AMIKET A HÍVÓ TÉNYLEG LÁTHAT -- lásd `maintenance-order-
   * visibility.ts` fejlécét a szabályért. A `customerFullyCoveredByUnits`
   * hívása LUSTA: csak akkor fut, ha VAN olyan sor, aminek szüksége van rá
   * (helyszín nélküli tétel) -- ma ez az ág `ensureSingleDepartment` miatt
   * nem is fordulhat elő, tehát a lusta hívás a gyakori esetben egyetlen
   * felesleges lekérdezést sem indít.
   */
  private async filterVisible(
    rows: readonly PortalMaintenanceOrderRow[],
    customerId: string,
    unitIds: readonly string[],
  ): Promise<PortalMaintenanceOrderRow[]> {
    const locations = rows.map((row) =>
      maintenanceOrderLocationView(row.items),
    );
    const needsCoverage = locations.some(
      (location) => location.hasCustomerWideItem,
    );
    const customerCovered = needsCoverage
      ? await customerFullyCoveredByUnits(customerId, unitIds)
      : false;
    return rows.filter((_, index) =>
      maintenanceOrderVisibleToScope(locations[index]!, {
        unitIds,
        customerCovered,
      }),
    );
  }

  private async departmentNames(
    rows: readonly PortalMaintenanceOrderRow[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows.flatMap((row) =>
          row.items
            .map((item) => item.contractItem.departmentId)
            .filter((id): id is string => id !== null),
        ),
      ),
    ];
    return this.repository.departmentNames(ids);
  }

  private toSummary(
    row: PortalMaintenanceOrderRow,
    departmentNames: Map<string, string>,
  ): MaintenanceOrderPartnerSummary {
    const location = maintenanceOrderLocationView(row.items);
    const names = location.departmentIds
      .map((id) => departmentNames.get(id))
      .filter((name): name is string => Boolean(name));
    return {
      id: row.id,
      number: row.number,
      contractNumber: row.contract.number,
      contractTitle: row.contract.title,
      status: row.status,
      period: HU_MONTH_YEAR.format(row.issuedAt),
      departmentName: names.length ? names.join(", ") : null,
      issuedAt: row.issuedAt.toISOString(),
    };
  }
}
