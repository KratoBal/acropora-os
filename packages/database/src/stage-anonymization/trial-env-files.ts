import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";

/**
 * THE `.env` FILES THE PRISMA CLIENT WOULD LOAD INTO THE TRIAL'S INSTANCE (task stage-anonim-proba; barracuda, #2331). The trial
 * builds the instance's environment from nothing, but a `.env` file can put variables back: the generated Prisma client (version 6)
 * reads two `.env` files whose locations were BAKED INTO it when it was generated (`relativeEnvPaths`: one at the project root, one
 * next to the schema), and writes every variable in them that the process does not already have into `process.env`. A repository
 * `.env` with live keys on the host, present when the client was generated, would reach the instance in spite of the clean
 * environment.
 *
 * So the trial MEASURES it: it reads the baked paths from the generated client, resolves them the way the client does (relative to
 * the generated directory), and reports the ones that exist. Any existing one fails the measurement; an unreadable block fails it
 * too (`null`): a client that stops carrying this block, or a version that loads in another way, must not read as "nothing loaded".
 * The finding names the file's path (not a secret), never anything in it.
 */
export function prismaLoadedEnvFiles(
  generatedIndexSource: string,
  generatedDir: string,
  exists: (path: string) => boolean,
  resolve: (base: string, relative: string) => string,
): string[] | null {
  const start = generatedIndexSource.indexOf('"relativeEnvPaths"');
  if (start === -1) return null;
  const open = generatedIndexSource.indexOf("{", start);
  const close = generatedIndexSource.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  const block = generatedIndexSource.slice(open, close + 1);
  const paths: string[] = [];
  for (const key of ["rootEnvPath", "schemaEnvPath"]) {
    const found = new RegExp(`"${key}"\\s*:\\s*(null|"([^"]*)")`).exec(block);
    // a key that is not in the block is a path the client does not have: nothing to load. A block with neither key is unreadable.
    if (found?.[2] !== undefined) paths.push(resolve(generatedDir, found[2]));
  }
  if (!/"rootEnvPath"|"schemaEnvPath"/.test(block)) return null;
  return paths.filter((path) => exists(path));
}

/**
 * The same measurement on the real generated client. `fromUrl` is the module the client is resolved FROM; the default is this file,
 * which sits in the database package that depends on `@prisma/client`: the application resolves the client through that same
 * package, so it is the same generated client. (A caller in another package, such as the API, cannot resolve `@prisma/client`
 * itself under pnpm's strict layout, which the first CI run showed: that read as "not measured".) `null` when the client or its
 * block cannot be read.
 */
export function measureGeneratedClientEnvFiles(
  fromUrl: string = import.meta.url,
): string[] | null {
  try {
    const clientDir = dirname(createRequire(fromUrl).resolve("@prisma/client"));
    const generated = join(clientDir, "..", "..", ".prisma", "client");
    return prismaLoadedEnvFiles(
      readFileSync(join(generated, "index.js"), "utf8"),
      generated,
      existsSync,
      resolvePath,
    );
  } catch {
    return null;
  }
}
