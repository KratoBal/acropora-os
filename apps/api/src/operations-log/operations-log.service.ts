import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  assignOperationsFieldKeys,
  normalizeOperationsText,
  operationsFieldErrors,
  type OperationsTaskTemplateDto,
  type OperationsTaskTemplateInput,
  type OperationsTaskTemplateListResponse,
} from "@acropora/types";

import {
  OperationsLogRepository,
  type OperationsTaskTemplateWrite,
} from "./operations-log.repository.js";

const NEM_TALALHATO = "A sablon nem található.";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJAI (task os-uzemeltetesi-naplo, S1). A szabályok: egy sablon PONTOSAN egy célra szól (egy élő
 * eszközre VAGY egy aktív eszköz-kategóriára), a mezők szabályai a közös `operationsFieldErrors`-ban állnak (a szerkesztő is
 * ezt futtatja), és a mezők kulcsait a szerver osztja ki (a meglévő mező megtartja a kulcsát: a bejegyzés, S2, az értéket
 * ezzel tárolja).
 */
@Injectable()
export class OperationsLogService {
  constructor(private readonly repository: OperationsLogRepository) {}

  async list(
    includeInactive: boolean,
  ): Promise<OperationsTaskTemplateListResponse> {
    return { items: await this.repository.listTemplates(includeInactive) };
  }

  async get(id: string): Promise<OperationsTaskTemplateDto> {
    const template = await this.repository.templateById(id);
    if (!template) throw new NotFoundException(NEM_TALALHATO);
    return template;
  }

  async create(
    input: OperationsTaskTemplateInput,
    actorId: string,
  ): Promise<OperationsTaskTemplateDto> {
    return this.repository.createTemplate(await this.checked(input), actorId);
  }

  async update(
    id: string,
    input: OperationsTaskTemplateInput & { isActive?: boolean },
    actorId: string,
  ): Promise<OperationsTaskTemplateDto> {
    const write = await this.checked(input);
    const updated = await this.repository.replaceTemplate(
      id,
      { ...write, isActive: input.isActive },
      actorId,
    );
    if (!updated) throw new NotFoundException(NEM_TALALHATO);
    return updated;
  }

  /**
   * A `DELETE` KIVEZET, NEM TÖRÖL, és a válasz ezt kimondja: a sablon kiesik a rögzítés kínálatából, de a későbbi bejegyzések
   * (S2) mellett olvasható marad.
   */
  async retire(id: string, actorId: string) {
    if (!(await this.repository.retireTemplate(id, actorId)))
      throw new NotFoundException(NEM_TALALHATO);
    return { retired: true } as const;
  }

  /** A bemenet ellenőrzése és a tároláshoz kész alakra hozása (a mezők kulcsaival). */
  private async checked(
    input: OperationsTaskTemplateInput,
  ): Promise<OperationsTaskTemplateWrite> {
    const name = input.name.trim();
    if (name === "")
      throw new BadRequestException("A sablon nevét meg kell adni.");

    const assetId = normalizeOperationsText(input.assetId);
    const assetCategoryId = normalizeOperationsText(input.assetCategoryId);
    if ((assetId === null) === (assetCategoryId === null))
      throw new BadRequestException(
        "A sablon pontosan egy célra szól: adj meg egy eszközt VAGY egy eszköz-kategóriát.",
      );
    if (assetId !== null && !(await this.repository.assetIsLive(assetId)))
      throw new BadRequestException(
        "Az eszköz nem található, vagy már archivált.",
      );
    if (
      assetCategoryId !== null &&
      !(await this.repository.categoryIsActive(assetCategoryId))
    )
      throw new BadRequestException(
        "Az eszköz-kategória nem található, vagy már kivezetett.",
      );

    const errors = operationsFieldErrors(input.fields);
    if (errors.length > 0) throw new BadRequestException(errors.join(" "));
    const keys = assignOperationsFieldKeys(input.fields);

    return {
      name,
      description: normalizeOperationsText(input.description),
      frequency: input.frequency,
      assetId,
      assetCategoryId,
      fields: input.fields.map((field, index) => ({
        key: keys[index]!,
        label: field.label.trim(),
        type: field.type,
        unit:
          field.type === "NUMBER" ? normalizeOperationsText(field.unit) : null,
        required: field.required ?? false,
        meterRole: field.type === "NUMBER" ? (field.meterRole ?? null) : null,
      })),
    };
  }
}
