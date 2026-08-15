import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AssetQrCode } from "@acropora/types";

import type {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import { createAssetQrSvg } from "./qr-svg.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

@Injectable()
export class ServiceAssetsService {
  constructor(private readonly repository: ServiceAssetsRepository) {}

  list(query: AssetListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const asset = await this.repository.detail(id);
    if (!asset) throw new NotFoundException("Az eszköz nem található.");
    return asset;
  }

  async scan(qrToken: string) {
    const asset = await this.repository.detailByQrToken(qrToken);
    if (!asset)
      throw new NotFoundException(
        "A QR-kódhoz nem tartozik érvényes eszközazonosító.",
      );
    return asset;
  }

  async create(input: CreateAssetDto, actorUserId: string) {
    await this.validateReferences({
      customerId: input.customerId,
      customerAddressId: input.customerAddressId,
      aquariumId: input.aquariumId,
      parentAssetId: input.parentAssetId,
      productVariantId: input.productVariantId,
    });
    try {
      return await this.repository.create(input, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateAssetDto, actorUserId: string) {
    const existing = await this.repository.basic(id);
    if (!existing) throw new NotFoundException("Az eszköz nem található.");
    const parentAssetId =
      input.parentAssetId === undefined
        ? existing.parentAssetId
        : input.parentAssetId;
    if (
      parentAssetId &&
      (await this.repository.wouldCreateCycle(id, parentAssetId))
    )
      throw new BadRequestException(
        "Az eszközhierarchia nem tartalmazhat önmagába visszatérő kapcsolatot.",
      );
    await this.validateReferences({
      customerId: existing.customerId,
      customerAddressId:
        input.customerAddressId === undefined
          ? existing.customerAddressId
          : input.customerAddressId,
      aquariumId:
        input.aquariumId === undefined ? existing.aquariumId : input.aquariumId,
      parentAssetId,
      productVariantId:
        input.productVariantId === undefined
          ? existing.productVariantId
          : input.productVariantId,
    });
    try {
      return await this.repository.update(id, input, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async rotateQr(id: string, actorUserId: string) {
    await this.detail(id);
    try {
      return await this.repository.rotateQr(id, actorUserId);
    } catch (error) {
      this.map(error);
    }
  }

  async qrCode(id: string): Promise<AssetQrCode> {
    const asset = await this.detail(id);
    const base = (
      process.env.ASSET_QR_BASE_URL?.trim() ||
      "acropora-os://assets/scan"
    ).replace(/\/+$/, "");
    const value = `${base}/${asset.qrToken}`;
    return {
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      value,
      svg: createAssetQrSvg(value),
    };
  }

  private async validateReferences(input: {
    customerId: string;
    customerAddressId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const context = await this.repository.validationContext(input);
    if (!context.customer)
      throw new BadRequestException("A kiválasztott partner nem található.");
    if (!context.customer.isActive)
      throw new BadRequestException(
        "Archivált partnerhez nem rögzíthető új eszköz vagy elhelyezés.",
      );
    if (input.customerAddressId && !context.address)
      throw new BadRequestException("A kiválasztott partnercím nem található.");
    if (context.address && context.address.customerId !== input.customerId)
      throw new BadRequestException(
        "A kiválasztott cím nem ehhez a partnerhez tartozik.",
      );
    if (input.aquariumId && !context.aquarium)
      throw new BadRequestException("A kiválasztott akvárium nem található.");
    if (
      context.aquarium &&
      (context.aquarium.customerId !== input.customerId ||
        !context.aquarium.isActive)
    )
      throw new BadRequestException(
        "Az akvárium nem aktív, vagy nem ehhez a partnerhez tartozik.",
      );
    if (input.parentAssetId && !context.parent)
      throw new BadRequestException("A kiválasztott szülőeszköz nem található.");
    if (context.parent && context.parent.customerId !== input.customerId)
      throw new BadRequestException(
        "A szülő- és gyermekeszköznek ugyanahhoz a partnerhez kell tartoznia.",
      );
    if (context.parent?.status === "RETIRED")
      throw new BadRequestException(
        "Kivezetett eszközhöz nem rendelhető új gyermekeszköz.",
      );
    if (
      context.parent?.customerAddressId &&
      input.customerAddressId &&
      context.parent.customerAddressId !== input.customerAddressId
    )
      throw new BadRequestException(
        "A gyermekeszköz helyszíne nem térhet el a szülőeszköz helyszínétől.",
      );
    if (
      context.parent?.aquariumId &&
      input.aquariumId &&
      context.parent.aquariumId !== input.aquariumId
    )
      throw new BadRequestException(
        "A gyermekeszköz akváriuma nem térhet el a szülőeszköz akváriumától.",
      );
    if (input.productVariantId && !context.productVariant)
      throw new BadRequestException("A kiválasztott termék nem található.");
    if (context.productVariant && !context.productVariant.isActive)
      throw new BadRequestException(
        "Archivált termék nem kapcsolható új eszközhöz.",
      );
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "ASSET_HIERARCHY_CYCLE")
      throw new BadRequestException(
        "Az eszközhierarchia nem tartalmazhat önmagába visszatérő kapcsolatot.",
      );
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "Az eszközt másik felhasználó módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("Az eszköz nem található.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "Az eszközazonosító már használatban van. Próbáld újra.",
      );
    throw error;
  }
}
