import { Injectable, NotFoundException } from "@nestjs/common";

import type { CreateProductDto } from "./dto/create-product.dto.js";
import type { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import type { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductRepository } from "./product.repository.js";

@Injectable()
export class ProductService {
  constructor(private readonly products: ProductRepository) {}

  createProduct(input: CreateProductDto, actorUserId?: string) {
    return this.products.create(input, actorUserId);
  }

  async updateProduct(id: string, input: UpdateProductDto) {
    await this.requireProduct(id);
    return this.products.update(id, input);
  }

  async archiveProduct(id: string) {
    await this.requireProduct(id);
    return this.products.archive(id);
  }

  getProduct(id: string) {
    return this.requireProduct(id);
  }

  listProducts(query: ProductListQueryDto) {
    return this.products.list(query);
  }

  listCategoryOptions() {
    return this.products.listCategoryOptions();
  }

  listBrandOptions() {
    return this.products.listBrandOptions();
  }

  private async requireProduct(id: string) {
    const product = await this.products.findById(id);
    if (!product) {
      throw new NotFoundException("A termék nem található.");
    }
    return product;
  }
}
