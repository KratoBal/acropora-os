/**
 * Reads the Prisma schema as text and checks the anonymization register
 * against it.
 *
 * The schema is read as TEXT, not through the generated client's DMMF: a
 * client generated before the last schema edit would describe an older field
 * set, and the check would then pass on a schema that no longer exists.
 *
 * The parser is deliberately strict. Inside a model block every line must be
 * blank, a comment, a block attribute (`@@...`) or a field. Anything else
 * throws, and so does a top-level block it does not know (a `view`, for
 * example). A field the parser silently skipped would be a field nobody
 * classified, which is exactly what the register exists to prevent.
 */

import {
  ANONYMIZATION_KINDS,
  type AnonymizationKindName,
} from "./anonymization-register.js";

/** Scalar types that can carry free-form data and therefore need a decision. */
const IN_SCOPE_TYPE = /^(String|Json|Bytes|Unsupported\("[^"]*"\))$/;

const KNOWN_TOP_LEVEL_BLOCKS = new Set([
  "model",
  "enum",
  "generator",
  "datasource",
]);

const FIELD_LINE = /^\s+(\w+)\s+(\w+(?:\("[^"]*"\))?)(\[\])?(\?)?(?:\s+(.*))?$/;

export interface SchemaField {
  readonly model: string;
  readonly name: string;
  /** The scalar or relation type without `[]` and `?`. */
  readonly type: string;
  readonly isList: boolean;
  /** Field attributes with any trailing `//` comment removed. */
  readonly attributes: string;
  readonly line: number;
}

export interface SchemaModel {
  readonly name: string;
  readonly fields: readonly SchemaField[];
}

/** Removes a trailing `//` comment that is not inside a string literal. */
function stripLineComment(text: string): string {
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && text[i - 1] !== "\\") inString = !inString;
    if (!inString && char === "/" && text[i + 1] === "/") {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

export function parseSchemaModels(schema: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  let current: { name: string; fields: SchemaField[] } | null = null;
  let otherBlock = false;
  let inBlockComment = false;

  schema.split("\n").forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return;
    }
    if (line.startsWith("/*")) {
      inBlockComment = !line.includes("*/");
      return;
    }
    if (line === "" || line.startsWith("//")) return;

    if (current === null && !otherBlock) {
      const block = /^(\w+)\s+(\w+)\s*\{$/.exec(line);
      if (!block) {
        throw new Error(
          `schema.prisma:${lineNumber}: unexpected top-level line: ${line}`,
        );
      }
      const [, keyword = "", name = ""] = block;
      if (!KNOWN_TOP_LEVEL_BLOCKS.has(keyword)) {
        throw new Error(
          `schema.prisma:${lineNumber}: unknown block "${keyword} ${name}"; the anonymization register check only knows models, so it refuses to guess`,
        );
      }
      if (keyword === "model") current = { name, fields: [] };
      else otherBlock = true;
      return;
    }

    if (line === "}") {
      if (current) models.push(current);
      current = null;
      otherBlock = false;
      return;
    }
    if (otherBlock || line.startsWith("@@")) return;

    const field = FIELD_LINE.exec(rawLine);
    if (!field || current === null) {
      throw new Error(
        `schema.prisma:${lineNumber}: cannot read this line as a field: ${line}`,
      );
    }
    const [, name = "", type = "", list, , attributes] = field;
    current.fields.push({
      model: current.name,
      name,
      type,
      isList: list === "[]",
      attributes: stripLineComment(attributes ?? ""),
      line: lineNumber,
    });
  });

  if (current !== null || otherBlock || inBlockComment) {
    throw new Error("schema.prisma: the file ends inside an open block");
  }
  return models;
}

export function isInScope(field: SchemaField): boolean {
  return IN_SCOPE_TYPE.test(field.type);
}

/** An `@id` the database generates itself cannot hold personal data. */
function isGeneratedId(field: SchemaField): boolean {
  return (
    /(^|\s)@id(\s|$)/.test(field.attributes) &&
    /@default\((cuid|uuid)\(\)\)/.test(field.attributes)
  );
}

/** The argument list of `@relation(...)`, with nested parentheses. */
function relationArguments(attributes: string): string | null {
  const start = attributes.indexOf("@relation(");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + "@relation".length; i < attributes.length; i += 1) {
    if (attributes[i] === "(") depth += 1;
    if (attributes[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return attributes.slice(start + "@relation(".length, i);
      }
    }
  }
  throw new Error(`unterminated @relation(...) in: ${attributes}`);
}

function listArgument(args: string, key: string): string[] {
  const match = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(args);
  if (!match) return [];
  return (match[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Every scalar that is the local side of a relation, and what it points to. */
function foreignKeys(model: SchemaModel): Map<string, ForeignKeyTarget> {
  const keys = new Map<string, ForeignKeyTarget>();
  for (const field of model.fields) {
    const args = relationArguments(field.attributes);
    if (args === null) continue;
    const local = listArgument(args, "fields");
    const remote = listArgument(args, "references");
    if (local.length !== remote.length) {
      throw new Error(
        `${model.name}.${field.name}: @relation fields and references differ in length`,
      );
    }
    local.forEach((name, i) => {
      keys.set(name, { model: field.type, field: remote[i] ?? "" });
    });
  }
  return keys;
}

interface ForeignKeyTarget {
  readonly model: string;
  readonly field: string;
}

export type DecisionSource =
  | { readonly by: "register" }
  | { readonly by: "generated-id" }
  | { readonly by: "foreign-key"; readonly references: string };

export interface FieldDecision {
  readonly kind: AnonymizationKindName;
  readonly source: DecisionSource;
}

export type AnonymizationRegister = Readonly<
  Record<string, Readonly<Record<string, AnonymizationKindName>>>
>;

export interface RegisterCheck {
  /** Every in-scope field of the schema, keyed `Model.field`. */
  readonly decisions: ReadonlyMap<string, FieldDecision>;
  readonly inScopeFieldCount: number;
  readonly problems: readonly string[];
}

/**
 * Exactly one decision per in-scope field: from a register row, or from a
 * structural rule (a generated `@id`, or a foreign key, which inherits the
 * decision of the field it references). A register row for a field a rule
 * already decides is a problem, so the two sources can never disagree.
 */
export function checkRegister(
  schema: string,
  register: AnonymizationRegister,
): RegisterCheck {
  const models = parseSchemaModels(schema);
  const byModel = new Map(models.map((model) => [model.name, model]));
  const problems: string[] = [];
  const decisions = new Map<string, FieldDecision>();
  const foreignKeysByModel = new Map(
    models.map((model) => [model.name, foreignKeys(model)]),
  );

  for (const [modelName, rows] of Object.entries(register)) {
    const model = byModel.get(modelName);
    if (!model) {
      problems.push(
        `register row for model ${modelName}, which does not exist`,
      );
      continue;
    }
    for (const [fieldName, kind] of Object.entries(rows)) {
      const field = model.fields.find((f) => f.name === fieldName);
      const key = `${modelName}.${fieldName}`;
      if (!field) {
        problems.push(`register row for ${key}, which does not exist`);
      } else if (!isInScope(field)) {
        problems.push(
          `register row for ${key}, which is ${field.type}, not a text, JSON or binary field`,
        );
      } else if (!(kind in ANONYMIZATION_KINDS)) {
        problems.push(`register row for ${key} names unknown kind "${kind}"`);
      }
    }
  }

  const resolving = new Set<string>();

  function decide(modelName: string, fieldName: string): FieldDecision | null {
    const key = `${modelName}.${fieldName}`;
    const known = decisions.get(key);
    if (known) return known;
    const model = byModel.get(modelName);
    const field = model?.fields.find((f) => f.name === fieldName);
    if (!model || !field || !isInScope(field)) return null;
    if (resolving.has(key)) {
      problems.push(`${key}: foreign-key cycle, no decision can be inherited`);
      return null;
    }
    resolving.add(key);

    const row = register[modelName]?.[fieldName];
    const target = foreignKeysByModel.get(modelName)?.get(fieldName);
    let decision: FieldDecision | null = null;

    if (isGeneratedId(field)) {
      if (row !== undefined) {
        problems.push(
          `${key} is decided twice: it is a generated @id, and it also has a register row`,
        );
      }
      decision = {
        kind: "generatedIdentifier",
        source: { by: "generated-id" },
      };
    } else if (target) {
      const references = `${target.model}.${target.field}`;
      if (row !== undefined) {
        problems.push(
          `${key} is decided twice: it is a foreign key to ${references}, and it also has a register row`,
        );
      }
      const inherited = decide(target.model, target.field);
      if (inherited) {
        decision = {
          kind: inherited.kind,
          source: { by: "foreign-key", references },
        };
      } else {
        problems.push(
          `${key}: foreign key to ${references}, which has no decision to inherit`,
        );
      }
    } else if (row !== undefined && row in ANONYMIZATION_KINDS) {
      decision = { kind: row, source: { by: "register" } };
    } else if (row === undefined) {
      problems.push(
        `${key} (${field.type}${field.isList ? "[]" : ""}, schema.prisma:${field.line}) has no anonymization decision`,
      );
    }

    resolving.delete(key);
    if (decision) decisions.set(key, decision);
    return decision;
  }

  let inScopeFieldCount = 0;
  for (const model of models) {
    for (const field of model.fields) {
      if (!isInScope(field)) continue;
      inScopeFieldCount += 1;
      decide(model.name, field.name);
    }
  }

  // A field that failed to resolve can be reached again through another
  // foreign key; report it once.
  return { decisions, inScopeFieldCount, problems: [...new Set(problems)] };
}
