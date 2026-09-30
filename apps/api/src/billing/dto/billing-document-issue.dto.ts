import { IsISO8601 } from "class-validator";

/** The issue request: the draft's `updatedAt` as last loaded (the conflict guard). */
export class BillingDocumentIssueDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
