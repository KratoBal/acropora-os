import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { sharedAncestor } from "../service-assets/unit-path.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { WorksheetsService } from "../worksheets/worksheets.service.js";

import type { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

/**
 * A KARBANTARTÁSI LAP ÉS A MUNKALAPOK SZERZŐDÉSTÉTELEKBŐL (karbantartási
 * felmérés S3, 2026-10-15). Ma egy hívója van, a megrendelőlap aláírás-útja
 * (`MaintenanceOrdersService.uploadSignedDocument`); a megrendelőlap nélküli
 * lap (S4) és a vevő saját megrendelőlapja (S6) ugyanezt hívja majd, hogy a
 * három út ugyanazt a helyszín-, eszköz- és munkalap-szabályt kapja.
 *
 * SIMA FÜGGVÉNY, NEM SZOLGÁLTATÁS: a függőségeit a hívó adja. Így a
 * `MaintenanceOrdersService` konstruktora nem változik, és egy másik modul
 * (S4) a saját szolgáltatásaival hívhatja, modul-körforgás nélkül.
 *
 * KÖZÖS TRANZAKCIÓ NINCS, és ez nem hiányosság, hanem a mai alak (lásd az
 * `uploadSignedDocument` fejlécét): a lap és a munkalapok a saját
 * szolgáltatásukon mennek át, az ismételhetőséget a determinisztikus
 * `clientOperationId`-k adják. Ezért a kulcsokat a HÍVÓ adja: az aláírás-út a
 * mai kulcsait, hogy egy újrafuttatás ugyanazt a sort találja.
 */

export interface ContractItemForJob {
  id: string;
  /** a tétel helyszíne; `null`, ha a tétel azóta elveszítette */
  departmentId: string | null;
  description: string;
  quantity: number;
}

type SiteRepository = Pick<
  MaintenanceOrdersRepository,
  "departmentTree" | "departmentPaths"
>;

export interface JobFromContractItemsDeps {
  repository: SiteRepository &
    Pick<MaintenanceOrdersRepository, "itemAssetsBySite">;
  serviceJobs: Pick<ServiceJobsService, "create">;
  worksheets: Pick<WorksheetsService, "create">;
  logger?: Pick<Logger, "warn">;
}

const defaultLogger = new Logger("JobFromContractItems");

/**
 * EGY KARBANTARTÁSI LAP EGY HELYSZÍNRE KÉSZÜL: az egyetlen helyszín, vagy ha
 * több van, a közös felső helyszínük (`sharedAncestor`). Ha nincs közös ős,
 * a tételek tényleg független helyszíneken vannak, és megállunk; a
 * hibaüzenet MEGNEVEZI a helyszíneket (a teljes utat, nem csak a kódot, lásd
 * `unit-path-lookup.ts` fejlécét), hogy ne kelljen találgatni, melyik tétel
 * melyik ágon van.
 */
export async function ensureOneSite(
  repository: SiteRepository,
  departmentIds: readonly string[],
): Promise<string> {
  const distinct = [...new Set(departmentIds)];
  if (distinct.length === 1) return distinct[0]!;
  const shared = sharedAncestor(
    distinct,
    await repository.departmentTree(distinct),
  );
  if (shared) return shared;
  const paths = await repository.departmentPaths(distinct);
  const names = distinct.map((id) => paths.get(id)?.join(" / ") ?? id);
  throw new BadRequestException(
    `A kiválasztott tételek különböző helyszínen vannak (${names.join(", ")}), ezért egyelőre nem készíthető belőlük egy karbantartási lap. Állíts ki külön megrendelőlapot helyszínenként.`,
  );
}

/**
 * A LAP HELYSZÍNE A TÉTELEKBŐL. NEM VÁRT ÁLLAPOT, ha egy tételnek nincs
 * helyszíne (a kiállítás ezt már kizárta, tehát közben szűnt meg): hangosan
 * állunk meg, mert egy csendben kihagyott tétel egy vevő által aláírt lapról
 * néma hiány lenne.
 *
 * Külön lépés a `createJobFromContractItems`-től, mert az aláírás-út a
 * helyszínt a dokumentum mentése ELŐTT dönti el.
 */
export async function siteForContractItems(
  repository: SiteRepository,
  items: readonly ContractItemForJob[],
): Promise<string> {
  const withoutSite = items.find((item) => !item.departmentId);
  if (withoutSite)
    throw new ConflictException(
      `A(z) "${withoutSite.description}" tételhez időközben megszűnt a helyszín-hozzárendelés, ezért nem hozható létre hozzá munkalap. A szerződés tételét előbb rendezni kell.`,
    );
  return ensureOneSite(
    repository,
    items.map((item) => item.departmentId as string),
  );
}

export interface JobFromContractItemsInput {
  title: string;
  contract: { id: string; customerId: string };
  /** a `siteForContractItems` eredménye */
  departmentId: string;
  items: readonly ContractItemForJob[];
  /** a lap `clientOperationId`-ja */
  jobOperationId: string;
  /** a munkalapoké: `<előtag><szerződéstétel id>` */
  worksheetOperationIdPrefix: string;
  /** a napló-sorhoz: honnan jött a hívás (például `maintenance-order <id>`) */
  source: string;
}

/**
 * A LAP ÉS A MUNKALAPOK. A lap a tételek eszközeinek UNIÓJÁT kapja, minden
 * munkalap a SAJÁT tételéét; csak a ma is a tétel helyszínén álló eszköz jön
 * át (a miértje az `itemAssetsBySite` fejlécén). A kimaradt eszközöket
 * tételenként visszaadja, és egy `warn` sorba írja, azonosítókkal, név
 * nélkül: a szerződés eszközlistája ilyenkor elavult, és ezt valakinek látnia
 * kell, de egy név a naplóban már személyes vagy üzleti adat lehet.
 *
 * A lapra nem ír megjegyzést a kimaradásról: a lap szövege az aláírás-út
 * mai eredménye, és egy újrafuttatás a meglévő sort adja vissza, tehát egy
 * megjegyzés csak az első futáson jelenne meg.
 */
export async function createJobFromContractItems(
  deps: JobFromContractItemsDeps,
  input: JobFromContractItemsInput,
  actor: AuthenticatedUser,
): Promise<{ serviceJobId: string; skippedAssets: Map<string, string[]> }> {
  const assets = await deps.repository.itemAssetsBySite(
    input.items.map((item) => ({
      contractItemId: item.id,
      departmentId: item.departmentId as string,
    })),
  );
  const skippedAssets = new Map<string, string[]>();
  for (const item of input.items) {
    const outside = assets.get(item.id)?.outside ?? [];
    if (outside.length === 0) continue;
    skippedAssets.set(item.id, outside);
    (deps.logger ?? defaultLogger).warn(
      `${input.source}: contract item ${item.id}: ${outside.length} asset(s) left off the job, not on the item's site: ${outside.join(", ")}`,
    );
  }
  const onSite = (itemId: string) => assets.get(itemId)?.onSite ?? [];

  const serviceJob = await deps.serviceJobs.create(
    {
      title: input.title,
      kind: "MAINTENANCE",
      contractId: input.contract.id,
      customerId: input.contract.customerId,
      departmentId: input.departmentId,
      assetIds: [...new Set(input.items.flatMap((item) => onSite(item.id)))],
      clientOperationId: input.jobOperationId,
    },
    actor,
  );

  for (const item of input.items) {
    await deps.worksheets.create(
      {
        customerId: input.contract.customerId,
        departmentId: item.departmentId as string,
        serviceJobId: serviceJob.id,
        subject: item.description,
        assetIds: onSite(item.id),
        clientOperationId: `${input.worksheetOperationIdPrefix}${item.id}`,
        lines: [
          {
            description: item.description,
            quantity: item.quantity,
            unit: "db",
            kind: "OTHER",
          },
        ],
      },
      actor,
    );
  }

  return { serviceJobId: serviceJob.id, skippedAssets };
}
