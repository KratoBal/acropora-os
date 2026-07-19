import { Module } from "@nestjs/common";

import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

@Module({
  controllers: [ProductController],
  providers: [ProductRepository, ProductService],
  exports: [ProductService],
})
export class ProductModule {}
