import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateProjectDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
}
