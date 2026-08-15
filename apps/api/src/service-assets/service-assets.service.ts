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

  owners() {
    return this.repository.owners();
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
      ownerType: input.ownerType,
      ownerId: input.ownerId,
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
    if ((input.ownerType === undefined) !== (input.ownerId === undefined))
      throw new BadRequestException(
        "A tulajdonos típusa és azonosítója csak együtt módosítható.",
      );
    const ownerType =
      input.ownerType ?? (existing.customerId ? "CUSTOMER" : "SUPPLIER");
    const ownerId = input.ownerId ?? existing.customerId ?? existing.supplierId;
    if (!ownerId)
      throw new BadRequestException("Az eszköz tulajdonosa hiányzik.");
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
      ownerType,
      ownerId,
      customerAddressId:
        ownerType === "SUPPLIER"
          ? null
          : input.customerAddressId === undefined
            ? existing.customerAddressId
            : input.customerAddressId,
      aquariumId:
        ownerType === "SUPPLIER"
          ? null
          : input.aquariumId === undefined
            ? existing.aquariumId
            : input.aquariumId,
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
      process.env.ASSET_QR_BASE_URL?.trim() || "acropora-os://assets/scan"
    ).replace(/\/+$/, "");
    const value = `${base}/${asset.qrToken}`;
    return {
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      value,
      svg: createAssetQrSvg(value),
      labelSizeMm: 30,
    };
  }

  async addDocument(
    id: string,
    type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER",
    file: Express.Multer.File,
    actorUserId: string,
  ) {
    await this.detail(id);
    if (
      file.mimetype !== "application/pdf" ||
      !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new BadRequestException("Csak érvényes PDF fájl tölthető fel.");
    const safeName = file.originalname
      .normalize("NFKC")
      .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
      .slice(0, 180);
    return this.repository.addDocument({
      assetId: id,
      type,
      fileName: safeName || "dokumentum.pdf",
      content: file.buffer,
      actorUserId,
    });
  }

  async document(id: string, documentId: string) {
    const document = await this.repository.document(id, documentId);
    if (!document) throw new NotFoundException("A dokumentum nem található.");
    return document;
  }

  async deleteDocument(id: string, documentId: string, actorUserId: string) {
    if (!(await this.repository.deleteDocument(id, documentId, actorUserId)))
      throw new NotFoundException("A dokumentum nem található.");
  }

  private async validateReferences(input: {
    ownerType: "CUSTOMER" | "SUPPLIER";
    ownerId: string;
    customerAddressId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const context = await this.repository.validationContext(input);
    const owner = context.customer ?? context.supplier;
    if (!owner)
      throw new BadRequestException("A kiválasztott partner nem található.");
    if (!owner.isActive)
      throw new BadRequestException(
        "Archivált partnerhez nem rögzíthető új eszköz vagy elhelyezés.",
      );
    if (
      input.ownerType === "SUPPLIER" &&
      (input.customerAddressId || input.aquariumId)
    )
      throw new BadRequestException(
        "Beszállító partnerhez vevői cím vagy akvárium nem rendelhető.",
      );
    if (input.customerAddressId && !context.address)
      throw new BadRequestException("A kiválasztott partnercím nem található.");
    if (context.address && context.address.customerId !== input.ownerId)
      throw new BadRequestException(
        "A kiválasztott cím nem ehhez a partnerhez tartozik.",
      );
    if (input.aquariumId && !context.aquarium)
      throw new BadRequestException("A kiválasztott akvárium nem található.");
    if (
      context.aquarium &&
      (context.aquarium.customerId !== input.ownerId ||
        !context.aquarium.isActive)
    )
      throw new BadRequestException(
        "Az akvárium nem aktív, vagy nem ehhez a partnerhez tartozik.",
      );
    if (input.parentAssetId && !context.parent)
      throw new BadRequestException(
        "A kiválasztott szülőeszköz nem található.",
      );
    if (
      context.parent &&
      (context.parent.customerId !==
        (input.ownerType === "CUSTOMER" ? input.ownerId : null) ||
        context.parent.supplierId !==
          (input.ownerType === "SUPPLIER" ? input.ownerId : null))
    )
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
