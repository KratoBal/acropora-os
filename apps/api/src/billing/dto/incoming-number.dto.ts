import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

/** Egy jóváhagyott postafiókos számla számának és keltének javítása. */
export class IncomingNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  documentNumber!: string;

  /** ÉÉÉÉ-HH-NN */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issueDate!: string;
}
