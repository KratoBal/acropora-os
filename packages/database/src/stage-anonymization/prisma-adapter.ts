import { Prisma } from "@prisma/client";

import {
  isInScope,
  listArgument,
  parseSchemaModels,
  relationArguments,
  type SchemaField,
} from "../anonymization-register-check.js";
import type { Row, RunnerDatabase } from "./runner.js";

/**
 * THE POSTGRES ADAPTER OF THE ANONYMIZATION RUNNER (stage anonymization chain, slice S6; card 07b56a1f). The runner's
 * `RunnerDatabase` over a Prisma client's raw SQL, read from the SCHEMA TEXT (the same text `checkRegister` reads), so the table
 * and column list can never be older than the register.
 *
 * ITS OWN NAME GUARD: `name` is what the SERVER says (`SELECT current_database()`), not what a connection string claims, and the
 * runner's guard refuses anything but a temporary database name before a row is read. Every identifier in the SQL comes from the
 * schema text and is checked against `^[A-Za-z_][A-Za-z0-9_]*$` before it is quoted; no value is ever put into SQL text (values
 * are parameters).
 *
 * WHAT IT READS AND WRITES: every column except `Unsupported(...)` ones (a generated `tsvector`: it cannot be read through the
 * client and cannot be written; its register kind is `derived`, recomputed from the anonymized columns). Pages are KEYSET pages
 * by primary key (`(a, b) > ($1, $2) ORDER BY a, b`), so deleting or updating rows between pages never skips one. A write
 * changes only the columns that differ from the original, and only text, JSON, byte and text-list columns can differ.
 * A field with `@map("column")` is read and written under its column name and handed to the runner under its field name.
 *
 * THE AGGREGATES the gate compares are measured on columns the transform never touches (the register's scope is by type: it
 * changes only text, JSON and bytes): per enum column the row count per value, per numeric column the exact sum (cast to
 * numeric, so a float column sums the same whatever the physical row order); per relation the non-NULL count and the distinct
 * referenced count. A model whose rows the transform DROPS (`excludeModels`) is left out of them, since its numbers move on purpose.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PAGE_SIZE = 500;
const NUMERIC_TYPES = new Set(["Int", "BigInt", "Decimal", "Float"]);

export interface SqlClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export const quote = (identifier: string): string => {
  if (!IDENTIFIER.test(identifier))
    throw new Error(`not a safe SQL identifier: ${JSON.stringify(identifier)}`);
  return `"${identifier}"`;
};

export interface AdapterColumn {
  field: string;
  column: string;
  type: string;
  isList: boolean;
  isOptional: boolean;
  /** Text, JSON, bytes: what the register can change. */
  inScope: boolean;
  /** `Unsupported(...)`: neither read nor written. */
  unsupported: boolean;
  isEnum: boolean;
}

export interface AdapterModel {
  name: string;
  columns: AdapterColumn[];
  /** Field names of the key the rows are found, paged and ordered by. */
  key: string[];
}

export interface AdapterRelation {
  model: string;
  fields: string[];
  targetModel: string;
  targetFields: string[];
}

const columnOf = (field: SchemaField): string =>
  /@map\("([^"]+)"\)/.exec(field.attributes)?.[1] ?? field.name;

function modelBlocks(schema: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm))
    blocks.set(match[1]!, match[2]!);
  return blocks;
}

function enumNames(schema: string): Set<string> {
  return new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]!));
}

/** The key rows are found by: `@id`, else `@@id([...])`, else the first required single `@unique`, else the first `@@unique([...])`. */
function keyOf(
  model: string,
  fields: readonly SchemaField[],
  block: string,
): string[] {
  const single = fields.find((f) => /(^|\s)@id(\s|\(|$)/.test(f.attributes));
  if (single) return [single.name];
  const compound = /@@id\(\[([^\]]*)\]/.exec(block);
  if (compound)
    return compound[1]!
      .split(",")
      .map((part) => part.trim().replace(/\(.*$/, ""));
  const unique = fields.find(
    (f) => /(^|\s)@unique(\s|\(|$)/.test(f.attributes) && !f.isOptional,
  );
  if (unique) return [unique.name];
  const compoundUnique = /@@unique\(\[([^\]]*)\]/.exec(block);
  if (compoundUnique)
    return compoundUnique[1]!
      .split(",")
      .map((part) => part.trim().replace(/\(.*$/, ""));
  throw new Error(
    `${model}: no @id, @@id or @unique: the runner cannot find or page its rows`,
  );
}

export function adapterModels(schema: string): AdapterModel[] {
  const blocks = modelBlocks(schema);
  const enums = enumNames(schema);
  const models: AdapterModel[] = [];
  for (const model of parseSchemaModels(schema)) {
    const fields = model.fields;
    const relationFields = new Set<string>();
    for (const field of fields)
      if (relationArguments(field.attributes) !== null)
        relationFields.add(field.name);
    const columns: AdapterColumn[] = [];
    for (const field of fields) {
      // a relation field (`customer Customer @relation(...)`) or a back-relation (`orders Order[]`) is not a column
      const isModelType = blocks.has(field.type);
      if (isModelType) continue;
      columns.push({
        field: field.name,
        column: columnOf(field),
        type: field.type,
        isList: field.isList,
        isOptional: field.isOptional,
        inScope: isInScope(field),
        unsupported: field.type.startsWith("Unsupported("),
        isEnum: enums.has(field.type),
      });
    }
    models.push({
      name: model.name,
      columns,
      key: keyOf(model.name, fields, blocks.get(model.name) ?? ""),
    });
  }
  return models;
}

/** Every relation of the schema with its local and referenced fields, in the order the schema lists them. */
export function adapterRelations(schema: string): AdapterRelation[] {
  const relations: AdapterRelation[] = [];
  for (const model of parseSchemaModels(schema)) {
    for (const field of model.fields) {
      const args = relationArguments(field.attributes);
      if (args === null) continue;
      const fields = listArgument(args, "fields");
      const targetFields = listArgument(args, "references");
      if (fields.length > 0 && fields.length === targetFields.length) {
        relations.push({
          model: model.name,
          fields,
          targetModel: field.type,
          targetFields,
        });
      }
    }
  }
  return relations;
}

// ---- SQL builders (pure, unit-tested) ----

const columnList = (model: AdapterModel): AdapterColumn[] =>
  model.columns.filter((c) => !c.unsupported);

const columnFor = (model: AdapterModel, field: string): AdapterColumn => {
  const column = model.columns.find((c) => c.field === field);
  if (!column) throw new Error(`${model.name}.${field}: not a column`);
  return column;
};

/** One keyset page: the first when `after` is undefined, else the rows whose key is greater than `after`. */
export function selectPageSql(model: AdapterModel, hasAfter: boolean): string {
  const select = columnList(model)
    .map((c) =>
      c.column === c.field
        ? quote(c.column)
        : `${quote(c.column)} AS ${quote(c.field)}`,
    )
    .join(", ");
  const keyColumns = model.key.map((field) =>
    quote(columnFor(model, field).column),
  );
  const order = keyColumns.join(", ");
  const where = hasAfter
    ? ` WHERE (${order}) > (${model.key.map((_, i) => `$${i + 1}`).join(", ")})`
    : "";
  return `SELECT ${select} FROM ${quote(model.name)}${where} ORDER BY ${order} LIMIT ${PAGE_SIZE}`;
}

export function deleteSql(model: AdapterModel): string {
  const where = model.key
    .map((field, i) => `${quote(columnFor(model, field).column)} = $${i + 1}`)
    .join(" AND ");
  return `DELETE FROM ${quote(model.name)} WHERE ${where}`;
}

export function updateSql(
  model: AdapterModel,
  changed: readonly string[],
): string {
  const sets = changed.map((field, i) => {
    const column = columnFor(model, field);
    const cast = column.type === "Json" ? "::jsonb" : "";
    return `${quote(column.column)} = $${i + 1}${cast}`;
  });
  const where = model.key
    .map(
      (field, i) =>
        `${quote(columnFor(model, field).column)} = $${changed.length + i + 1}`,
    )
    .join(" AND ");
  return `UPDATE ${quote(model.name)} SET ${sets.join(", ")} WHERE ${where}`;
}

export function orphanSql(
  relation: AdapterRelation,
  models: ReadonlyMap<string, AdapterModel>,
): string {
  const local = models.get(relation.model)!;
  const target = models.get(relation.targetModel)!;
  const lc = relation.fields.map(
    (f) => `c.${quote(columnFor(local, f).column)}`,
  );
  const tc = relation.targetFields.map(
    (f) => `t.${quote(columnFor(target, f).column)}`,
  );
  const notNull = lc.map((c) => `${c} IS NOT NULL`).join(" AND ");
  const match = lc.map((c, i) => `${tc[i]} = ${c}`).join(" AND ");
  return `SELECT COUNT(*)::int AS n FROM ${quote(relation.model)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${quote(relation.targetModel)} t WHERE ${match})`;
}

export function correlationSql(
  relation: AdapterRelation,
  models: ReadonlyMap<string, AdapterModel>,
): string {
  const local = models.get(relation.model)!;
  const lc = relation.fields.map((f) => quote(columnFor(local, f).column));
  const notNull = lc.map((c) => `${c} IS NOT NULL`).join(" AND ");
  const distinct = lc.length === 1 ? lc[0]! : `ROW(${lc.join(", ")})`;
  return `SELECT COUNT(*)::int AS nonnull, COUNT(DISTINCT ${distinct})::int AS refs FROM ${quote(relation.model)} WHERE ${notNull}`;
}

export const enumDistributionSql = (
  model: AdapterModel,
  column: AdapterColumn,
): string =>
  `SELECT ${quote(column.column)}::text AS v, COUNT(*)::int AS n FROM ${quote(model.name)} GROUP BY 1 ORDER BY 1`;

export const sumSql = (model: AdapterModel, column: AdapterColumn): string =>
  `SELECT COALESCE(SUM(${quote(column.column)}::numeric), 0)::text AS s FROM ${quote(model.name)}`;

// ---- the adapter ----

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
};

export interface PrismaAdapterOptions {
  /** Models whose rows the transform drops: left out of the aggregates and pairings (their numbers move on purpose). */
  excludeModels?: ReadonlySet<string>;
}

/** The value a column takes when the transform sets it to NULL: a JSON column needs Prisma's database NULL, the others plain null. */
const parameter = (column: AdapterColumn, value: unknown): unknown => {
  if (value === null || value === undefined)
    return column.type === "Json" ? Prisma.DbNull : null;
  if (column.type === "Json") return JSON.stringify(value);
  return value;
};

export async function createPrismaRunnerDatabase(
  client: SqlClient,
  schema: string,
  options: PrismaAdapterOptions = {},
): Promise<RunnerDatabase> {
  /** The one row a single-row query returns (the array index is unchecked in this project, so say it once, here). */
  const firstRow = async <T>(
    query: string,
    ...values: unknown[]
  ): Promise<T> => {
    const rows = await client.$queryRawUnsafe<T[]>(query, ...values);
    const row = rows[0];
    if (row === undefined) throw new Error("the query returned no row");
    return row;
  };
  const models = adapterModels(schema);
  const byName = new Map(models.map((m) => [m.name, m]));
  const relations = adapterRelations(schema);
  const excluded = options.excludeModels ?? new Set<string>();
  const { name } = await firstRow<{ name: string }>(
    "SELECT current_database() AS name",
  );
  if (!name) throw new Error("the server did not say which database this is");

  const model = (modelName: string): AdapterModel => {
    const found = byName.get(modelName);
    if (!found) throw new Error(`${modelName}: not a model of the schema`);
    return found;
  };
  const keyValues = (m: AdapterModel, row: Row): unknown[] =>
    m.key.map((field) => row[field]);

  return {
    name,
    models: () => models.map((m) => m.name),
    async countRows(modelName) {
      const { n } = await firstRow<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${quote(modelName)}`,
      );
      return n;
    },
    async *rows(modelName) {
      const m = model(modelName);
      let after: unknown[] | undefined;
      for (;;) {
        const page = await client.$queryRawUnsafe<Row[]>(
          selectPageSql(m, after !== undefined),
          ...(after ?? []),
        );
        for (const row of page) yield row;
        if (page.length < PAGE_SIZE) return;
        after = keyValues(m, page[page.length - 1]!);
      }
    },
    async replaceRow(modelName, original, replacement) {
      const m = model(modelName);
      const changed = Object.keys(replacement).filter(
        (field) => !sameValue(original[field], replacement[field]),
      );
      if (changed.length === 0) return;
      const values = changed.map((field) =>
        parameter(columnFor(m, field), replacement[field]),
      );
      await client.$executeRawUnsafe(
        updateSql(m, changed),
        ...values,
        ...keyValues(m, original),
      );
    },
    async deleteRow(modelName, original) {
      const m = model(modelName);
      await client.$executeRawUnsafe(deleteSql(m), ...keyValues(m, original));
    },
    async orphanCounts() {
      const out: Record<string, number> = {};
      for (const relation of relations) {
        const { n } = await firstRow<{ n: number }>(
          orphanSql(relation, byName),
        );
        out[
          `${relation.model}.${relation.fields.join("+")} -> ${relation.targetModel}`
        ] = n;
      }
      return out;
    },
    async invariants() {
      const out: Record<string, number | string> = {};
      for (const m of models) {
        if (excluded.has(m.name)) continue;
        for (const column of m.columns) {
          if (column.unsupported || column.isList) continue;
          if (column.isEnum) {
            for (const { v, n } of await client.$queryRawUnsafe<
              { v: string | null; n: number }[]
            >(enumDistributionSql(m, column))) {
              out[`${m.name}.${column.field}=${v ?? "NULL"}`] = n;
            }
          } else if (NUMERIC_TYPES.has(column.type)) {
            const { s } = await firstRow<{ s: string }>(sumSql(m, column));
            out[`${m.name}.${column.field} sum`] = s;
          }
        }
      }
      return out;
    },
    async correlations() {
      const out: Record<string, number | string> = {};
      for (const relation of relations) {
        if (excluded.has(relation.model) || excluded.has(relation.targetModel))
          continue;
        const { nonnull, refs } = await firstRow<{
          nonnull: number;
          refs: number;
        }>(correlationSql(relation, byName));
        const key = `${relation.model}.${relation.fields.join("+")} -> ${relation.targetModel}`;
        out[`${key} non-null`] = nonnull;
        out[`${key} distinct`] = refs;
      }
      return out;
    },
    async migrationsClean() {
      const { n } = await firstRow<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`,
      );
      return n === 0;
    },
    async healthOk() {
      const { ok } = await firstRow<{ ok: number }>("SELECT 1 AS ok");
      return ok === 1;
    },
  };
}
