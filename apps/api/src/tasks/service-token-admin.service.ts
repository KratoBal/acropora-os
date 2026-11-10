import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { generateSessionToken } from "../auth/session-token.util.js";
import {
  SERVICE_TOKEN_DEFAULT_DAILY_LIMIT,
  type CreateServiceTokenDto,
} from "./dto/service-token-admin.dto.js";
import {
  ServiceTokenAdminRepository,
  type ServiceTokenAdminView,
} from "./service-token-admin.repository.js";

export interface CreatedServiceToken extends ServiceTokenAdminView {
  /** THE RAW KEY, THIS ONE TIME. The database holds its hash only; nobody can read it again, a lost key is revoked and remade. */
  token: string;
  /** What to do with the record: the content entry's allow-list names the record's `id`, not the key. */
  hint: string;
}

@Injectable()
export class ServiceTokenAdminService {
  constructor(private readonly repository: ServiceTokenAdminRepository) {}

  list(): Promise<ServiceTokenAdminView[]> {
    return this.repository.list();
  }

  async create(
    input: CreateServiceTokenDto,
    actorUserId: string,
  ): Promise<CreatedServiceToken> {
    const rawToken = generateSessionToken("svc_");
    const result = await this.repository.create(
      {
        name: input.name,
        slug: input.slug,
        userEmail: input.userEmail,
        dailyLimit: input.dailyLimit ?? SERVICE_TOKEN_DEFAULT_DAILY_LIMIT,
        rawToken,
      },
      actorUserId,
    );
    if (result.kind === "refused") throw new BadRequestException(result.reason);
    if (result.kind === "slug-taken")
      throw new ConflictException("Ilyen slug-gal már van token.");
    return {
      ...result.token,
      token: rawToken,
      hint: `A tartalom-bejárathoz az ACROPORA_CONTENT_AGENT_TOKEN_IDS listába a rekord azonosítója (${result.token.id}) kerül, nem a kulcs.`,
    };
  }

  async revoke(
    slug: string,
    actorUserId: string,
  ): Promise<ServiceTokenAdminView> {
    const result = await this.repository.revoke(slug, actorUserId);
    if (result.kind === "not-found")
      throw new NotFoundException("Nincs ilyen slug-gal token.");
    return result.token;
  }
}
