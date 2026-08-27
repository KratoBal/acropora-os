import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Logger,
  Post,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import {
  DEVICE_TOKEN_SHAPE_MESSAGE,
  isNativeDeviceToken,
} from "./device-token.rules.js";
import {
  ForgetDeviceTokenDto,
  RegisterDeviceTokenDto,
} from "./dto/device-token.dto.js";

/**
 * Where a phone says "this is me, notify me here".
 *
 * No permission decorator: the global auth guard already requires a signed-in
 * colleague, and registering a device is not somebody else's business to
 * grant. The owner is taken from the session and never from the body - a
 * client that could name the user could subscribe a colleague's phone to its
 * own notifications.
 *
 * Both outcomes are written to the log, because a TestFlight round is read
 * from there. A refused registration and an app that was never opened look
 * identical otherwise, and telling them apart is worth a build.
 *
 * THE TOKEN ITSELF IS NEVER LOGGED. It is a credential for reaching
 * somebody's phone, and the log is read by more people than the device table
 * is - the same rule the assignment event follows.
 */
@Controller("notifications/device-tokens")
export class DeviceTokenController {
  private readonly logger = new Logger(DeviceTokenController.name);

  constructor(private readonly repository: DeviceTokenRepository) {}

  @Post()
  async register(
    @Body() input: RegisterDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const bundleId = input.bundleId.trim();

    if (!isNativeDeviceToken(input.token)) {
      this.logger.warn(
        `Eszköz-token elutasítva, nem natív alak: felhasználó ${user.id}, alkalmazás ${bundleId}, hossz ${input.token.length}.`,
      );
      throw new BadRequestException(DEVICE_TOKEN_SHAPE_MESSAGE);
    }

    const { firstTime } = await this.repository.register({
      userId: user.id,
      token: input.token.toLowerCase(),
      bundleId,
      platform: input.platform ?? "IOS",
    });

    this.logger.log(
      `Eszköz-token regisztrálva: felhasználó ${user.id}, alkalmazás ${bundleId}, ${
        firstTime ? "új eszköz" : "ismert eszköz"
      }.`,
    );

    return { ok: true };
  }

  /**
   * A TELEFON KIKAPCSOLJA MAGAROL AZ ERTESITEST.
   *
   * A sor TENYLEGESEN torlodik, nem egy jelolot allitunk: amig a token a
   * tablaban van, a kuldo oda is kuld, tehat egy "kikapcsolva" jelolo mellett
   * az ertesites tovabb erkezne. Egy kapcsolo, ami hazudik, rosszabb, mint a
   * hianyzo kapcsolo.
   *
   * A gazda a munkamenetbol jon: a torles a felhasznalojara szurve fut, tehat
   * egy ismert token birtokaban sem lehet MAS keszuleket lekapcsolni.
   *
   * A DELETE torzsben kapja a tokent, nem az utvonalban: a token hitelesito
   * adat, az utvonal viszont bekerul a hozzaferesi naplokba -- ugyanaz a
   * szabaly, amiert ez a vezerlo sosem naplozza magat a tokent.
   */
  @Delete()
  async forget(
    @Body() input: ForgetDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const removed = await this.repository.forget({
      userId: user.id,
      token: input.token.toLowerCase(),
    });

    this.logger.log(
      `Eszköz-token leszedve: felhasználó ${user.id}, ${
        removed > 0
          ? "a készülék többé nem kap értesítést"
          : "ehhez a kollégához nem tartozott ilyen eszköz"
      }.`,
    );

    return { ok: true, removed };
  }
}
