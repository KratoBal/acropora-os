import { IsString, MaxLength, MinLength } from "class-validator";

export class IssueCompletionCertificateDto {
  @IsString() @MinLength(1) @MaxLength(64) serviceJobId!: string;
}
