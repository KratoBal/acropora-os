import { BadRequestException, Injectable } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { Prisma, prisma } from "@acropora/database";
import {
  RENTAL_CONTRACT_LIMITS as L,
  unknownRentalContractVariables,
  type RentalSettings,
} from "@acropora/types";

import { DEFAULT_RENTAL_CONTRACT_TEMPLATE } from "./rental-contract-default.js";

/** The one settings row's id. */
export const RENTAL_SETTING_ID = "DEFAULT";

/**
 * THE FULL STATE IS SENT ON EVERY SAVE (a PUT, not a PATCH): the editor shows all three fields, and a `null` is a decision
 * ("back to the built-in text", "not set yet"), not an omission.
 */
export class SaveRentalSettingsDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MinLength(L.template.min, { message: "A szerződés szövege nem lehet üres." })
  @MaxLength(L.template.max)
  contractTemplate!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "A késedelmi szorzó legfeljebb két tizedesjegyű szám legyen." },
  )
  @Min(L.lateFeeMultiplier.min)
  @Max(L.lateFeeMultiplier.max)
  lateFeeMultiplier!: number | null;

  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt({ message: "A napok száma egész szám legyen." })
  @Min(L.replacementAfterDays.min)
  @Max(L.replacementAfterDays.max)
  replacementAfterDays!: number | null;
}

@Injectable()
export class RentalSettingsService {
  async get(): Promise<RentalSettings> {
    const row = await prisma.rentalSetting.findUnique({
      where: { id: RENTAL_SETTING_ID },
    });
    return {
      contractTemplate:
        row?.contractTemplate ?? DEFAULT_RENTAL_CONTRACT_TEMPLATE,
      contractTemplateIsDefault: !row?.contractTemplate,
      lateFeeMultiplier: row?.lateFeeMultiplier?.toNumber() ?? null,
      replacementAfterDays: row?.replacementAfterDays ?? null,
    };
  }

  /**
   * An unknown `{{...}}` place is refused at save, by name: on paper it would print as written, and the desk would hand out
   * a contract with a hole in it. The built-in text sent back unchanged is stored as NULL, so a later improvement of the
   * built-in text reaches everyone who never edited it.
   */
  async save(
    input: SaveRentalSettingsDto,
    actorId: string,
  ): Promise<RentalSettings> {
    if (input.contractTemplate !== null) {
      const unknown = unknownRentalContractVariables(input.contractTemplate);
      if (unknown.length > 0)
        throw new BadRequestException(
          `Ismeretlen mező a szövegben: ${unknown.map((name) => `{{${name}}}`).join(", ")}. A választható mezők a szerkesztő mellett állnak.`,
        );
    }
    const contractTemplate =
      input.contractTemplate === DEFAULT_RENTAL_CONTRACT_TEMPLATE
        ? null
        : input.contractTemplate;
    const data = {
      contractTemplate,
      lateFeeMultiplier:
        input.lateFeeMultiplier === null
          ? null
          : new Prisma.Decimal(input.lateFeeMultiplier),
      replacementAfterDays: input.replacementAfterDays,
      updatedById: actorId,
    };
    await prisma.rentalSetting.upsert({
      where: { id: RENTAL_SETTING_ID },
      create: { id: RENTAL_SETTING_ID, ...data },
      update: data,
    });
    return this.get();
  }
}
