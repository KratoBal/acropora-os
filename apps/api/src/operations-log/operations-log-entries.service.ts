import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  normalizeOperationsText,
  operationsEntryErrors,
  type OperationsLogEntryCreateResponse,
  type OperationsLogEntryDto,
  type OperationsLogEntryInput,
  type OperationsLogEntryListResponse,
  type OperationsTaskFieldDto,
  type OperationsTaskTemplateDto,
  type OperationsTaskTemplateListResponse,
} from "@acropora/types";

import {
  OperationsLogEntriesRepository,
  type OperationsLogEntryFilter,
  type OperationsLogEntryValueWrite,
} from "./operations-log-entries.repository.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { CreateServiceJobDto } from "../service-jobs/dto.js";
import { OperationsLogRepository } from "./operations-log.repository.js";

const DEFAULT_LIMIT = 50;

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSEI (task os-uzemeltetesi-naplo, S2a).
 *
 * A RÖGZÍTÉS IDEMPOTENS: a telefon offline sorba teszi, az újraküldés (megszakadt válasz, kétszeri indítás) a MÁR rögzített
 * bejegyzést adja vissza `created: false` jelzéssel, nem újat. A kulcs globálisan egyedi, ezért az újraküldés csak ugyanattól a
 * rögzítőtől fogadható el: más felhasználó kulcsára nem kap vissza idegen bejegyzést (409).
 *
 * A BEJEGYZÉS A SABLON PILLANATFELVÉTELÉT HORDOZZA (név, gyakoriság, minden érték mellett a mező címkéje, típusa, mértékegysége és
 * vízóra szerepe): egy későbbi átnevezés vagy kivezetés a régi bejegyzést és a belőle készülő kimutatást nem változtatja meg.
 *
 * KÉT BEFOGADÁSI SZABÁLY, AMELY SZÁNDÉKOSAN ENGED: a kivezetett sablonra és a kivezetett eszközre is fogad bejegyzést (a munka
 * megtörtént; egy offline sorban várt rögzítést a közben történt kivezetés nem dobhat el), és a kivezetett mező értéke is érvényes.
 */
@Injectable()
export class OperationsLogEntriesService {
  private readonly logger = new Logger(OperationsLogEntriesService.name);

  constructor(
    private readonly entries: OperationsLogEntriesRepository,
    private readonly templates: OperationsLogRepository,
    private readonly serviceJobs: ServiceJobsService,
  ) {}

  /** A rögzítés kínálata egy eszközhöz: az aktív sablonok, amelyek az eszközre vagy a kategóriájára szólnak. */
  async templatesForAsset(
    assetId: string,
  ): Promise<OperationsTaskTemplateListResponse> {
    const asset = await this.entries.assetRef(assetId);
    if (!asset) throw new NotFoundException("Az eszköz nem található.");
    return { items: await this.templates.activeTemplatesForAsset(asset) };
  }

  async colleagues() {
    return { items: await this.entries.assignableColleagues() };
  }

  async get(id: string): Promise<OperationsLogEntryDto> {
    const entry = await this.entries.byId(id);
    if (!entry) throw new NotFoundException("A bejegyzés nem található.");
    return entry;
  }

  async list(query: {
    assetId?: string;
    templateId?: string;
    from?: string;
    to?: string;
    anomalyOnly?: boolean;
    limit?: number;
  }): Promise<OperationsLogEntryListResponse> {
    const filter: OperationsLogEntryFilter = {
      assetId: query.assetId,
      templateId: query.templateId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      anomalyOnly: query.anomalyOnly,
      limit: query.limit ?? DEFAULT_LIMIT,
    };
    return this.entries.list(filter);
  }

  async create(
    input: OperationsLogEntryInput,
    actorId: string,
  ): Promise<OperationsLogEntryCreateResponse> {
    // az újraküldés ELŐSZÖR: ha a bejegyzés már megvan, a közben megváltozott sablon vagy eszköz nem teheti kérdésessé
    const existing = await this.entries.byClientOperationId(
      input.clientOperationId,
    );
    if (existing)
      return this.withTicket(this.replay(existing, actorId), actorId);

    const template = await this.templates.templateById(input.templateId);
    if (!template) throw new NotFoundException("A sablon nem található.");
    const asset = await this.entries.assetRef(input.assetId);
    if (!asset) throw new NotFoundException("Az eszköz nem található.");
    if (!this.targetMatches(template, asset))
      throw new BadRequestException(
        "A sablon nem erre az eszközre szól: válassz az eszközhöz tartozó sablont.",
      );

    const fields = [...template.fields, ...template.retiredFields];
    const errors = operationsEntryErrors(input, fields);
    if (errors.length > 0) throw new BadRequestException(errors.join(" "));

    const participantIds = await this.participants(
      input.participantIds ?? [],
      actorId,
    );

    const write = {
      clientOperationId: input.clientOperationId,
      templateId: template.id,
      templateName: template.name,
      frequency: template.frequency,
      assetId: asset.id,
      startedAt: new Date(input.startedAt),
      finishedAt: new Date(input.finishedAt),
      participantIds,
      anomaly: input.anomaly === true,
      anomalyNote:
        input.anomaly === true
          ? normalizeOperationsText(input.anomalyNote)
          : null,
      internalNote: normalizeOperationsText(input.internalNote),
      values: this.valueRows(fields, input.values),
    };
    const result = await this.entries.create(write, actorId);
    return this.withTicket(
      result.created
        ? { entry: result.entry, created: true }
        : this.replay(result, actorId),
      actorId,
    );
  }

  /**
   * A RENDELLENESSÉGBŐL AUTOMATIKUSAN HIBAJEGY NYÍLIK (S3), a bejegyzéshez és az eszközhöz kötve.
   *
   * A BEJEGYZÉS A BIZONYÍTÉK, A JEGY A KÖVETKEZMÉNY: a jegy nyitásának hibája ezért NEM buktatja a rögzítést (a bejegyzés megvan, a
   * válaszban a `serviceJob` null), és a következő újraküldés (a telefon a megszakadt választ újrapróbálja) PÓTOLJA a jegyet. A
   * kettő együtt idempotens: a jegy kulcsa a bejegyzés azonosítójából készül (`ops-anomaly:<id>`), tehát ha a jegy létrejött, csak az
   * összekötés maradt el, az újrapróbálás ugyanazt a jegyet kapja vissza, és nem másodikat nyit.
   *
   * A JEGYET A RÖGZÍTŐ NEVÉN NYITJUK (belső hatókör), a partner és a helyszín az eszközből következik (a `ServiceJobsService` vezeti
   * le), az eszköz felkerül a jegyre. Delegáltat nem állítunk: azt az iroda osztja.
   */
  private async withTicket(
    response: OperationsLogEntryCreateResponse,
    actorId: string,
  ): Promise<OperationsLogEntryCreateResponse> {
    const { entry } = response;
    if (!entry.anomaly || entry.serviceJob) return response;
    try {
      const context = await this.entries.ticketContext(entry.id);
      if (!context || context.serviceJobId || !context.anomaly) return response;
      const job = await this.serviceJobs.create(
        {
          title:
            `Rendellenesség: ${context.templateName}, ${context.asset.assetNumber} ${context.asset.name}`.slice(
              0,
              300,
            ),
          description: [
            context.anomalyNote ?? "",
            "",
            `Üzemeltetési napló: ${context.templateName}`,
            `Eszköz: ${context.asset.assetNumber} ${context.asset.name}`,
            `Kezdés: ${context.startedAt.toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}`,
          ].join("\n"),
          kind: "REPAIR",
          originAssetId: context.asset.id,
          // a partner a HELYSZÍNBŐL jön: a jegy-szolgáltatás az eszköz saját `customerId` mezőjéből vezetne le, az pedig hiányozhat
          // (a CI-n mért eset: helyszínes eszköz partner-mező nélkül, "Helyszínt csak partnerrel együtt lehet megadni"); megadva a
          // szolgáltatás ellentmondás-ellenőrzése a helyszínhez méri
          ...(context.asset.department?.customerId
            ? { customerId: context.asset.department.customerId }
            : {}),
          clientOperationId: `ops-anomaly:${entry.id}`,
        } as CreateServiceJobDto,
        context.recordedById || actorId,
      );
      await this.entries.linkServiceJob(entry.id, job.id);
      const refreshed = await this.entries.byId(entry.id);
      return refreshed ? { ...response, entry: refreshed } : response;
    } catch (error) {
      this.logger.warn(
        `A rendellenesség hibajegye nem nyílt meg (bejegyzés ${entry.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return response;
    }
  }

  private replay(
    existing: { entry: OperationsLogEntryDto; recordedById: string },
    actorId: string,
  ): OperationsLogEntryCreateResponse {
    if (existing.recordedById !== actorId)
      throw new ConflictException(
        "Ez a művelet-azonosító már egy másik rögzítésé.",
      );
    return { entry: existing.entry, created: false };
  }

  /** A sablon célja: egy konkrét eszköz VAGY egy kategória (az eszköz kategóriája egyezik). */
  private targetMatches(
    template: OperationsTaskTemplateDto,
    asset: { id: string; categoryId: string | null },
  ): boolean {
    return template.target.kind === "ASSET"
      ? template.target.assetId === asset.id
      : template.target.categoryId === asset.categoryId;
  }

  /** A rögzítő mindig résztvevő; a többieknek aktív belső kollégának kell lenniük. */
  private async participants(
    requested: readonly string[],
    actorId: string,
  ): Promise<string[]> {
    const others = requested.filter((id) => id !== actorId);
    const valid = await this.entries.assignableIds(others);
    if (others.some((id) => !valid.has(id)))
      throw new BadRequestException(
        "A résztvevők között ismeretlen vagy nem választható kolléga van.",
      );
    return [actorId, ...others];
  }

  /**
   * AZ ÉRTÉKEK A MEZŐ PILLANATFELVÉTELÉVEL, a sablon sorrendjében. Csak a kitöltött érték kerül tárolásra (az üres szöveg és a
   * hiányzó érték nincs), az igen/nem `false` és a szám `0` viszont érték. A fénykép mező nem ide tartozik (S2b).
   */
  private valueRows(
    fields: readonly OperationsTaskFieldDto[],
    values: OperationsLogEntryInput["values"],
  ): OperationsLogEntryValueWrite[] {
    const rows: OperationsLogEntryValueWrite[] = [];
    for (const field of fields) {
      const value = values[field.key];
      if (value === undefined || field.type === "PHOTO") continue;
      const text = typeof value === "string" ? value.trim() : null;
      if (text === "") continue;
      rows.push({
        fieldKey: field.key,
        fieldType: field.type,
        label: field.label,
        unit: field.unit,
        meterRole: field.meterRole,
        numberValue: field.type === "NUMBER" ? (value as number) : null,
        booleanValue: field.type === "BOOLEAN" ? (value as boolean) : null,
        textValue: field.type === "TEXT" ? text : null,
      });
    }
    return rows;
  }
}
