import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import { AquariumMaintainersRepository } from "./aquarium-maintainers.repository.js";
import { AquariumsRepository } from "./aquariums.repository.js";

@Injectable()
export class AquariumMaintainersService {
  constructor(
    private readonly repository: AquariumMaintainersRepository,
    private readonly aquariums: AquariumsRepository,
  ) {}

  selectable() {
    return this.repository.selectable();
  }

  /**
   * A LISTA TELJES CSERÉJE. Ugyanaz a hiba-alak, mint a munkalap
   * felelős-választójánál (`requireAssignableUsers`): a hiányzó és a nem
   * jogosult kolléga ugyanazt a választ kapja, mert a hívó teendője
   * ugyanaz -- mást kell választani.
   *
   * BELSŐS LÉPÉS: a karbantartó BELSŐ kolléga (lásd az
   * `AquariumMaintainer` séma-fejlécét, "PARTNER-FIÓK NEM KERÜLHET IDE"),
   * tehát a kiosztás sem lehet partner-oldali.
   */
  async set(
    aquariumId: string,
    userIds: readonly string[],
    user: AuthenticatedUser,
  ) {
    requireInternalWriter(user, "Karbantartók kiosztása");
    const aquarium = await this.aquariums.detail(aquariumId);
    if (!aquarium) throw new NotFoundException("Az akvárium nem található.");

    const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length > 0) {
      const eligible = await this.repository.selectableUserIds(unique);
      const rejected = unique.filter((id) => !eligible.has(id));
      if (rejected.length > 0)
        throw new BadRequestException(
          "A karbantartónak jelölt kolléga nem található, vagy a szerepköre nem engedi az akvárium karbantartását.",
        );
    }

    await this.repository.set(aquariumId, unique);
    return this.aquariums.detail(aquariumId);
  }
}
