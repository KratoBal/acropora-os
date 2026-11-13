import {
  BadRequestException,
  ConflictException,
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
  OperationsTemplateConflictError,
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
    const keys = await this.repository.fieldKeys(id);
    if (!keys) throw new NotFoundException(NEM_TALALHATO);
    /*
      A TÍPUSVÁLTÁS ÚJ MEZŐ (barracuda, #2499): egy meglévő mező más típussal ugyanazt a kulcsot kapná, és a bejegyzések (S2) egy
      kulcs alatt régi szám és új szöveg értéket keverne. A kulcsot a típusváltó mező nem viheti tovább: új kulcsot kap, a régi
      mező kivezetést (a bejegyzései a régi típussal olvashatók maradnak).
    */
    const adjusted: OperationsTaskTemplateInput & { isActive?: boolean } = {
      ...input,
      fields: input.fields.map((field) => {
        // a kulcsot a kiosztás is körülvágva olvassa (`assignOperationsFieldKeys`): az összevetés ugyanazt a kulcsot nézi
        const given = field.key?.trim();
        return given &&
          keys.typeOf.get(given) !== undefined &&
          keys.typeOf.get(given) !== field.type
          ? { ...field, key: null }
          : field;
      }),
    };
    const write = await this.checked(adjusted, keys);
    try {
      const updated = await this.repository.replaceTemplate(
        id,
        {
          ...write,
          isActive: input.isActive,
          expectedUpdatedAt: input.expectedUpdatedAt,
        },
        actorId,
      );
      if (!updated) throw new NotFoundException(NEM_TALALHATO);
      return updated;
    } catch (error) {
      // a betöltött sablon közben megváltozott: nem írjuk csendben felül a másik szerkesztő mezőit
      if (error instanceof OperationsTemplateConflictError)
        throw new ConflictException(
          "A sablont közben más módosította. Töltsd be újra, és vidd át a változtatásaidat.",
        );
      throw error;
    }
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
    existing: { used: Set<string>; active: Set<string> } = {
      used: new Set(),
      active: new Set(),
    },
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
    const keys = assignOperationsFieldKeys(input.fields, existing);

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
