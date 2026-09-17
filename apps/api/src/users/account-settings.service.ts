import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { isWellFormedSigningCode } from "../worksheets/worksheet-signing-code.js";
import { verifyPassword } from "./password.util.js";
import { UsersRepository } from "./users.repository.js";
import type {
  ChangeOwnPasswordDto,
  ChangeOwnSigningCodeDto,
} from "./dto/account-settings.dto.js";

@Injectable()
export class AccountSettingsService {
  constructor(private readonly repository: UsersRepository) {}

  async changePassword(input: ChangeOwnPasswordDto, actorUserId: string) {
    await this.requireCurrentPassword(actorUserId, input.currentPassword);
    await this.repository.changeOwnPassword(actorUserId, input.newPassword);
    return { updated: true };
  }

  async changeSigningCode(input: ChangeOwnSigningCodeDto, actorUserId: string) {
    await this.requireCurrentPassword(actorUserId, input.currentPassword);
    if (!isWellFormedSigningCode(input.signingCode))
      throw new BadRequestException("Az aláírókód pontosan négy számjegy.");
    await this.repository.changeOwnSigningCode(
      actorUserId,
      input.signingCode.trim(),
    );
    return { updated: true };
  }

  private async requireCurrentPassword(userId: string, password: string) {
    const hash = await this.repository.passwordHash(userId);
    if (!hash || !(await verifyPassword(password, hash)))
      throw new UnauthorizedException("A jelenlegi jelszó nem megfelelő.");
  }
}
