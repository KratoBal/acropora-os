import { pathToFileURL } from "node:url";

import { generateSessionToken } from "../auth/session-token.util.js";
import {
  parseServiceTokenCommand,
  ServiceTokenCommandError,
} from "./service-token.command.js";
import { ServiceTokenRepository } from "./service-token.repository.js";

export interface ServiceTokenCliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

const processOutput: ServiceTokenCliOutput = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

/**
 * Operator tool for minting and revoking the credentials used by
 * `POST /tasks/ingest`. There is deliberately no admin UI: with a handful
 * of tokens, a screen for managing them would be more attack surface than
 * convenience.
 *
 * The raw token is printed exactly once, here, and never stored - only its
 * SHA-256 hash reaches the database. If it is lost, mint a new one and
 * revoke the old; it cannot be recovered.
 *
 * `--user <e-mail>` binds the token to an existing account, and that binding
 * is what the content-agent entrance requires: a token without one is refused
 * there rather than falling back to some default author. Task ingest does not
 * look at it, so the tokens minted before this option keep working unchanged.
 */
export async function main(
  argv: readonly string[],
  repository: ServiceTokenRepository = new ServiceTokenRepository(),
  output: ServiceTokenCliOutput = processOutput,
): Promise<number> {
  try {
    const command = parseServiceTokenCommand(argv);

    if (command.action === "list") {
      output.stdout(`${JSON.stringify(await repository.list(), null, 2)}\n`);
      return 0;
    }

    if (command.action === "create") {
      const rawToken = generateSessionToken("svc_");
      const created = await repository.create({
        name: command.name,
        slug: command.slug,
        rawToken,
        dailyLimit: command.dailyLimit,
        userEmail: command.userEmail,
      });
      output.stdout(
        `${JSON.stringify({ ...created, token: rawToken }, null, 2)}\n`,
      );
      output.stderr(
        "A fenti token csak most olvasható ki. Mentsd el biztonságos helyre; az adatbázisban csak a lenyomata van.\n",
      );
      return 0;
    }

    const revoked = await repository.revoke(command.slug);
    if (!revoked) {
      output.stderr(`Nincs ilyen token: ${command.slug}\n`);
      return 1;
    }
    output.stdout(`${JSON.stringify(revoked, null, 2)}\n`);
    return 0;
  } catch (error) {
    output.stderr(
      `${
        error instanceof ServiceTokenCommandError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Ismeretlen hiba."
      }\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(1));
}
