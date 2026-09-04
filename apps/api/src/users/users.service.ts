import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { UsersRepository } from "./users.repository.js";
import type {
  CreateUserDto,
  SetUserPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user.dto.js";

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  list(query: UserListQueryDto) {
    return this.repository.list(query);
  }

  async detail(id: string) {
    const user = await this.repository.detail(id);
    if (!user) throw new NotFoundException("A felhasználó nem található.");
    return user;
  }

  async create(input: CreateUserDto, actorId: string) {
    await this.requireCustomerExists(input.customerId);
    try {
      return await this.repository.create(input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateUserDto, actorId: string) {
    const existing = await this.detail(id);
    await this.requireCustomerExists(input.customerId);
    this.requireAtMostOnePartner(existing, input.customerId);
    try {
      return await this.repository.update(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async setPassword(id: string, input: SetUserPasswordDto, actorId: string) {
    await this.detail(id);
    try {
      return await this.repository.setPassword(id, input, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async activate(id: string, actorId: string) {
    const user = await this.detail(id);
    if (user.isActive) return user;
    try {
      return await this.repository.setActive(id, true, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  async deactivate(id: string, actorId: string) {
    if (id === actorId)
      throw new BadRequestException(
        "Saját magadat nem tudod inaktiválni. Kérj meg egy másik adminisztrátort.",
      );
    const user = await this.detail(id);
    if (!user.isActive) return user;
    try {
      return await this.repository.setActive(id, false, actorId);
    } catch (error) {
      this.map(error);
    }
  }

  /**
   * A MEGADOTT VEVO LETEZZEN.
   *
   * A relacion idegenkulcs all, tehat enelkul is elbukna a beszuras -- de egy
   * `P2003` a kepernyon nyers adatbazis-hibakent jelenne meg, es a kollega nem
   * tudna, MELYIK mezovel van baj. A `null` es a hianyzo ertek nem ellenorzendo:
   * az a "sajat kollega" eset.
   */
  private async requireCustomerExists(customerId?: string | null) {
    if (!customerId) return;
    if (!(await this.repository.customerExists(customerId)))
      throw new BadRequestException(
        "A megadott vevő nem található, ezért a felhasználót nem lehet hozzákötni.",
      );
  }

  /**
   * EGY FIOK LEGFELJEBB EGY PARTNERHEZ TARTOZHAT -- ES EZ NEM STILUS.
   *
   * Az adatbazisban `CHECK` megszoritas all ra
   * (`User_at_most_one_partner_check`), tehat a masodik kotes ott ugyis
   * elbukna. Azert all MEGIS itt, mert a kovetkezmenye nem egy hibauzenet: a
   * `partnerScopeOf` DOB, ha mind a ketto ki van toltve, vagyis egy ilyen sor
   * tulajdonosa MINDEN keresre hibat kapna, es a felulet szamara ugy nezne ki,
   * mintha a fiok elromlott volna.
   *
   * A ket megszoritas nem ugyanaz: az adatbazise megakadalyozza, ez pedig
   * MEGMONDJA, mi a baj es mit kell tenni. Egy nyers `CHECK` sertes a
   * kepernyon ertelmezhetetlen.
   */
  private requireAtMostOnePartner(
    existing: { supplierId?: string | null },
    customerId?: string | null,
  ) {
    if (!customerId) return;
    if (existing.supplierId)
      throw new BadRequestException(
        "Ez a felhasználó már egy szállítóhoz van kötve, ezért vevőhöz nem köthető. " +
          "Egy fiók legfeljebb egy partner nevében léphet be: előbb a szállítói kötést kell megszüntetni.",
      );
  }

  private map(error: unknown): never {
    if (error instanceof Error && error.message === "STALE_UPDATE")
      throw new ConflictException(
        "A felhasználót másik adminisztrátor módosította. Frissítsd az oldalt.",
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException("Ez az e-mail cím már használatban van.");
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new NotFoundException("A felhasználó nem található.");
    throw error;
  }
}
