import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";
import type { QuoteTemplateInput } from "@acropora/types";

import { DEFAULT_QUOTE_TEMPLATES } from "./quote-template-defaults.js";
import { templateBody } from "./quote-templates.service.js";

/**
 * THE STARTING TEMPLATES, LOADED ONCE (#1582, acrobot 28001).
 *
 * Idempotent by name: a template whose name already exists (archived or not)
 * is left alone, so a second run writes nothing and says so. Nothing is
 * overwritten or deleted. Without `--apply` it only prints what it would add;
 * every template is checked with the editor's rules first, so a broken one
 * stops the run before anything is written.
 *
 *   node dist/quotes/quote-templates-seed.cli.js           # the plan
 *   node dist/quotes/quote-templates-seed.cli.js --apply   # the writes
 */

export interface SeedOutput {
  stdout: (t: string) => void;
  stderr: (t: string) => void;
}

export interface SeedDeps {
  /** every template name that exists, archived ones too */
  names: () => Promise<string[]>;
  /** the write; called only with `--apply` */
  create: (
    template: QuoteTemplateInput,
    body: ReturnType<typeof templateBody>,
  ) => Promise<void>;
}

export async function runQuoteTemplatesSeed(
  argv: readonly string[],
  out: SeedOutput,
  deps: SeedDeps,
  templates: readonly QuoteTemplateInput[] = DEFAULT_QUOTE_TEMPLATES,
): Promise<number> {
  const apply = argv.includes("--apply");
  let checked: Array<{
    template: QuoteTemplateInput;
    body: ReturnType<typeof templateBody>;
  }>;
  try {
    checked = templates.map((template) => ({
      template,
      body: templateBody(template),
    }));
  } catch (error) {
    out.stderr(
      `Hibás alapsablon, nem írtam semmit: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const existing = new Set(await deps.names());
  const missing = checked.filter((c) => !existing.has(c.template.name));
  for (const c of checked)
    out.stdout(
      `${existing.has(c.template.name) ? "megvan " : apply ? "felveszem" : "felvenném"}  ${c.template.name}\n`,
    );
  if (!apply) {
    out.stdout(
      `${missing.length} sablont vennék fel (próbafutás; írni a --apply kapcsolóval lehet).\n`,
    );
    return 0;
  }
  for (const c of missing) await deps.create(c.template, c.body);
  out.stdout(
    missing.length
      ? `${missing.length} sablon felvéve.\n`
      : "Nem kellett semmit felvenni: mind megvan.\n",
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runQuoteTemplatesSeed(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      names: async () =>
        (await prisma.quoteTemplate.findMany({ select: { name: true } })).map(
          (t) => t.name,
        ),
      create: async (template, body) => {
        await prisma.quoteTemplate.create({
          data: {
            name: template.name,
            priceDisplay: template.priceDisplay,
            defaultValidityDays: template.defaultValidityDays,
            ...body,
          },
        });
      },
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
