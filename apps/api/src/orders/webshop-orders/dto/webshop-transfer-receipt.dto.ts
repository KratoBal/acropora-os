import { IsString, Matches, MaxLength } from "class-validator";

/** Az „Utalás beérkezett” kézi rögzítése (bb3a6bd5): a jóváírás napja és a hivatkozás. */
export class WebshopTransferReceiptDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  receivedOn!: string;

  @IsString()
  @MaxLength(200)
  reference!: string;
}
