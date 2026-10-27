import { BadRequestException, Injectable } from "@nestjs/common";
import {
  FAVORITE_LIMITS,
  isFavoriteHref,
  type FavoriteListResponse,
} from "@acropora/types";

import { FavoritesRepository } from "./favorites.repository.js";

const ROSSZ_UTVONAL =
  "A kedvenc oldal útvonala nem megfelelő: a menü egy oldalának belső útvonala kell.";

/**
 * A KEDVENCEK a belépett felhasználó SAJÁTJAI: a felhasználó azonosítója a
 * munkamenetből jön, soha nem a kérésből, tehát más kedvencét nem lehet sem
 * olvasni, sem írni.
 *
 * A JOGOSULTSÁG NEM ITT DŐL EL. A kedvenc egy útvonal; hogy a felhasználó
 * láthatja-e az oldalt, azt a menü és az oldal saját végpontja dönti, és a
 * kedvenc ezt nem emeli meg: egy olyan útvonal, amihez nincs joga, a Kedvencek
 * menüben sem jelenik meg, és az oldal megnyitása ugyanúgy megtagadott.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly repository: FavoritesRepository) {}

  async list(userId: string): Promise<FavoriteListResponse> {
    return { items: await this.repository.list(userId) };
  }

  async add(userId: string, href: string): Promise<FavoriteListResponse> {
    if (!isFavoriteHref(href)) throw new BadRequestException(ROSSZ_UTVONAL);
    const current = await this.repository.list(userId);
    if (
      !current.includes(href) &&
      current.length >= FAVORITE_LIMITS.maxPerUser
    ) {
      throw new BadRequestException(
        `Legfeljebb ${FAVORITE_LIMITS.maxPerUser} kedvenc oldal tárolható. Vegyél ki egyet, mielőtt újat teszel be.`,
      );
    }
    await this.repository.add(userId, href);
    return this.list(userId);
  }

  async remove(userId: string, href: string): Promise<FavoriteListResponse> {
    if (!isFavoriteHref(href)) throw new BadRequestException(ROSSZ_UTVONAL);
    await this.repository.remove(userId, href);
    return this.list(userId);
  }
}
