import { IsISO8601, IsString, MaxLength, MinLength } from "class-validator";

export class ApproveFoxpostSettlementLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  invoiceNumber!: string;

  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
