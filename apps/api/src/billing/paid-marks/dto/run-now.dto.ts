import { IsBoolean, IsOptional } from "class-validator";

/** "Futtatás most" (e64540fd); `allTime`: egyszer korhatár nélkül (acrobot 43776), alapból a napi ablak. */
export class RunNowDto {
  @IsOptional()
  @IsBoolean()
  allTime?: boolean;
}
