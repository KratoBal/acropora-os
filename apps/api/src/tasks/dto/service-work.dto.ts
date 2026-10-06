import { IsIn, IsOptional } from "class-validator";
import { MY_SERVICE_WORK_VIEWS, type MyServiceWorkView } from "@acropora/types";

export class ServiceWorkQueryDto {
  @IsIn([...MY_SERVICE_WORK_VIEWS])
  @IsOptional()
  view: MyServiceWorkView = "OPEN";
}
