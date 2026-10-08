import { IsIn } from "class-validator";

/** How the project ends: done, or called off. */
export class CloseProjectDto {
  @IsIn(["COMPLETED", "CANCELLED"]) status!: "COMPLETED" | "CANCELLED";
}
