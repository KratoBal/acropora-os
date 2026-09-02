export interface CreateServiceTokenCommand {
  action: "create";
  name: string;
  slug: string;
  dailyLimit: number;
  /**
   * MELYIK FELHASZNÁLÓ NEVÉBEN jár el a token, e-mail címmel megnevezve.
   *
   * `null`, ha nincs megadva, és ez nem hiányosság: felhasználó nélküli token
   * továbbra is kiadható, mert a feladat-felvitel ilyeneket használ élesben. Az
   * ilyen token viszont a tartalom-bejáratot NEM nyitja ki, mert azt az őrző
   * elutasítja. Így a régi használati eset változatlan marad, és az új nem áll
   * elő félig bekötve.
   *
   * E-MAIL, NEM AZONOSÍTÓ, mert a fiókot ember hozza létre egy felületen, és az
   * e-mail címet látja. Egy cuid-ot ki kellene másolnia az adatbázisból.
   */
  userEmail: string | null;
}

export interface RevokeServiceTokenCommand {
  action: "revoke";
  slug: string;
}

export interface ListServiceTokenCommand {
  action: "list";
}

export type ServiceTokenCommand =
  | CreateServiceTokenCommand
  | RevokeServiceTokenCommand
  | ListServiceTokenCommand;

export const DEFAULT_DAILY_LIMIT = 200;

/**
 * A slug becomes the permanent namespace prefix of every `sourceRef` the
 * token writes, so it is kept to a shape that stays readable in a database
 * column and cannot smuggle the `:` separator that delimits it.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export class ServiceTokenCommandError extends Error {}

export function parseServiceTokenCommand(
  argv: readonly string[],
): ServiceTokenCommand {
  const [action, ...rest] = argv;
  const options = parseOptions(rest);

  if (action === "list") return { action: "list" };

  if (action === "create") {
    const slug = requireOption(options, "slug");
    const name = requireOption(options, "name");
    if (!SLUG_PATTERN.test(slug))
      throw new ServiceTokenCommandError(
        "A slug csak kisbetűt, számot és kötőjelet tartalmazhat, 2-40 karakter.",
      );
    const dailyLimit = options.has("daily-limit")
      ? Number(options.get("daily-limit"))
      : DEFAULT_DAILY_LIMIT;
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1)
      throw new ServiceTokenCommandError(
        "A --daily-limit értéke pozitív egész szám kell legyen.",
      );
    const userEmail = options.get("user")?.trim() ?? null;
    if (options.has("user") && !userEmail)
      throw new ServiceTokenCommandError(
        "A --user kapcsolóhoz e-mail cím kell.",
      );
    return { action: "create", name, slug, dailyLimit, userEmail };
  }

  if (action === "revoke")
    return { action: "revoke", slug: requireOption(options, "slug") };

  throw new ServiceTokenCommandError(
    "Használat: service-token create --slug <slug> --name <név> [--user <e-mail>] [--daily-limit <n>] | revoke --slug <slug> | list",
  );
}

function parseOptions(argv: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) continue;
    const [key, inlineValue] = splitOnce(argument.slice(2), "=");
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new ServiceTokenCommandError(`A --${key} kapcsolóhoz érték kell.`);
    options.set(key, value);
    if (inlineValue === undefined) index += 1;
  }
  return options;
}

function splitOnce(
  value: string,
  separator: string,
): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key)?.trim();
  if (!value)
    throw new ServiceTokenCommandError(`Hiányzó kötelező kapcsoló: --${key}.`);
  return value;
}
