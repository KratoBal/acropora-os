import { Module } from "@nestjs/common";

import { PostalCodeController } from "./postal-code.controller.js";
import { PostalCodeService } from "./postal-code.service.js";

@Module({
  controllers: [PostalCodeController],
  providers: [PostalCodeService],
})
export class PostalCodeModule {}
