import { IsObject, IsOptional, Matches } from "class-validator";

const FINGERPRINT = /^[0-9a-f]{64}$/;

/** `POST /admin/partner-migration/preview`: az opcionális kötési döntések (partner-kód -> vevő-sor azonosító). */
export class PartnerMigrationPreviewDto {
  @IsObject() @IsOptional() binds?: Record<string, string>;
}

/** `POST /admin/partner-migration/apply`: a próba lenyomata (és ugyanazok a döntések). */
export class PartnerMigrationApplyDto extends PartnerMigrationPreviewDto {
  @Matches(FINGERPRINT) fingerprint!: string;
}

/** `POST /admin/partner-migration/restore/apply`: a visszaállítási próba lenyomata. */
export class PartnerMigrationRestoreApplyDto {
  @Matches(FINGERPRINT) fingerprint!: string;
}
