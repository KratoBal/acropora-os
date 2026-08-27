import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { DeviceTokenController } from "./device-token.controller.js";
import type { DeviceTokenRepository } from "./device-token.repository.js";

const user = { id: "user-2" } as AuthenticatedUser;
const nativeToken = "AB".repeat(32);

function repository(firstTime = true) {
  const registered: Array<Record<string, unknown>> = [];
  const value = {
    register: async (input: Record<string, unknown>) => {
      registered.push(input);
      return { firstTime };
    },
  } as unknown as DeviceTokenRepository;
  return { repository: value, registered };
}

/** Reads what the controller wrote, without a Nest logger around it. */
function captureLog(controller: DeviceTokenController) {
  const lines: Array<{ level: "log" | "warn"; message: string }> = [];
  const logger = (
    controller as unknown as {
      logger: { log(m: string): void; warn(m: string): void };
    }
  ).logger;
  logger.log = (message: string) => lines.push({ level: "log", message });
  logger.warn = (message: string) => lines.push({ level: "warn", message });
  return lines;
}

describe("device token registration", () => {
  it("stores the token in lower case, under the signed-in colleague", async () => {
    const { repository: store, registered } = repository();
    const controller = new DeviceTokenController(store);
    captureLog(controller);

    await controller.register(
      { token: nativeToken, bundleId: " hu.acropora.os " },
      user,
    );

    assert.deepEqual(registered, [
      {
        userId: "user-2",
        token: nativeToken.toLowerCase(),
        bundleId: "hu.acropora.os",
        platform: "IOS",
      },
    ]);
  });

  /**
   * A TestFlight round is read from the log. A registration that succeeded and
   * one that was never attempted have to look different there, and so do a new
   * phone and the same phone registering again.
   */
  it("writes down the colleague, the app variant and whether the phone is new", async () => {
    const { repository: store } = repository(true);
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    await controller.register(
      { token: nativeToken, bundleId: "hu.acropora.os" },
      user,
    );

    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, "log");
    assert.match(lines[0]!.message, /user-2/);
    assert.match(lines[0]!.message, /hu\.acropora\.os/);
    assert.match(lines[0]!.message, /új eszköz/);
  });

  it("says so when a known phone registers again", async () => {
    const { repository: store } = repository(false);
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    await controller.register(
      { token: nativeToken, bundleId: "hu.acropora.os" },
      user,
    );

    assert.match(lines[0]!.message, /ismert eszköz/);
  });

  /**
   * The refusal is the reason the rule moved out of the DTO. `ValidationPipe`
   * answers before the controller runs, so a rejected registration used to
   * leave no trace, and during a round it would look exactly like an app that
   * was never opened - the one thing the round is meant to tell apart.
   */
  it("refuses an Expo token and leaves a trace of the refusal", async () => {
    const { repository: store, registered } = repository();
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    await assert.rejects(
      controller.register(
        {
          token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
          bundleId: "hu.acropora.os",
        },
        user,
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("natív APNs"),
    );

    assert.deepEqual(registered, []);
    assert.equal(lines[0]?.level, "warn");
    assert.match(lines[0]!.message, /user-2/);
    assert.match(lines[0]!.message, /nem natív alak/);
  });

  /**
   * A token is a credential for reaching somebody's phone, and the log is read
   * by more people than the device table is. Asserted on both paths, because
   * this is exactly the kind of thing that gets added later "just to debug".
   */
  it("never writes the token itself, on either path", async () => {
    const { repository: store } = repository();
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    await controller.register(
      { token: nativeToken, bundleId: "hu.acropora.os" },
      user,
    );
    await controller
      .register({ token: "nem-token", bundleId: "hu.acropora.os" }, user)
      .catch(() => undefined);

    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.equal(line.message.toLowerCase().includes("ab".repeat(32)), false);
      assert.equal(line.message.includes("nem-token"), false);
    }
  });
});

describe("device token removal", () => {
  function forgetting(removed: number) {
    const calls: Array<{ userId: string; token: string }> = [];
    const value = {
      forget: async (input: { userId: string; token: string }) => {
        calls.push(input);
        return removed;
      },
    } as unknown as DeviceTokenRepository;
    return { repository: value, calls };
  }

  /**
   * A GAZDA A MUNKAMENETBOL JON, sosem a torzsbol. A token onmagaban is
   * azonosit egy sort, tehat token-alapu torlesnel barki, aki egy masik telefon
   * tokenjet ismeri, le tudna kapcsolni azt a keszuleket az ertesitesekrol.
   */
  it("scopes the removal to the signed-in colleague, not just the token", async () => {
    const { repository: store, calls } = forgetting(1);
    const controller = new DeviceTokenController(store);
    captureLog(controller);

    await controller.forget({ token: nativeToken }, user);

    assert.deepEqual(calls, [
      { userId: "user-2", token: nativeToken.toLowerCase() },
    ]);
  });

  /**
   * A TOKEN SOSEM KERUL NAPLOBA -- ugyanaz a szabaly, mint a regisztracional: a
   * naplot tobben olvassak, mint az eszkoz-tablat.
   */
  it("says what happened without writing the token anywhere", async () => {
    const { repository: store } = forgetting(1);
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    await controller.forget({ token: nativeToken }, user);

    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, "log");
    assert.ok(!lines[0]!.message.includes(nativeToken.toLowerCase()));
    assert.match(lines[0]!.message, /nem kap értesítést/);
  });

  /**
   * A NULLA TALALAT NEM HIBA, de nem is siker-uzenet: az a valasz, hogy ehhez a
   * kollegahoz nem tartozott ilyen eszkoz. A hivo ettol meg nyugodtan
   * kikapcsoltnak tekintheti magat -- a sor nincs ott.
   */
  it("reports how many devices it actually took off", async () => {
    const { repository: store } = forgetting(0);
    const controller = new DeviceTokenController(store);
    const lines = captureLog(controller);

    const result = await controller.forget({ token: nativeToken }, user);

    assert.deepEqual(result, { ok: true, removed: 0 });
    assert.match(lines[0]!.message, /nem tartozott/);
  });
});
