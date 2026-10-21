import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum.js";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import { getMetadataStorage } from "class-validator";

import { ReefClubModule } from "./reefclub.module.js";

/**
 * EVERY ID A /rc/v1 REQUEST CAN CARRY IS IN THE ACCEPTANCE MATRIX, OR SAYS WHY NOT (plan v6.1,
 * 5.2/10; task reefclub-proba-osszesito).
 *
 * The integration suite reads the path parameters from the router (reefclub-akvarium, `idRoutes`).
 * This reads the rest the plan names: the VALIDATION SCHEMAS of the request body and query, and
 * the named path and query parameters, from the ReefClub controllers' own metadata, nested
 * schemas included. Every field that looks like an identifier must be listed here, with the place
 * that measures it. A new one is red until somebody decides where it is measured: a body field
 * that loads a row without its parent is exactly the leak point 1 exists for (barracuda, v1).
 *
 * What turns this red: a new id-like field in a ReefClub request; a listed field that no longer
 * exists (the list must not rot); the reader finding no controller or no field at all.
 */
// class-transformer's `@Type` metadata, for the nested schemas. Its storage module ships no type
// declaration, so it is imported by a variable path with the one method this reads typed here.
const transformerStorage: string = "class-transformer/cjs/storage.js";
const { defaultMetadataStorage } = (await import(transformerStorage)) as {
  defaultMetadataStorage: {
    findTypeMetadata(
      target: unknown,
      property: string,
    ): { typeFunction?: () => unknown } | undefined;
  };
};

const ID_LIKE = /(^id$|Id$|Ids$|_id$)/;

const KNOWN: Record<string, string> = {
  // path parameters: the 5.2/1 matrix (reefclub-akvarium.integration.spec.ts, KNOWN_PARAMS)
  "param:id":
    "5.2/1: az akvárium-útvonalak idegen azonosítóval, bájtra a nem létező 404-e",
  "param:occasionId": "5.2/1 és 5.2/2: alkalom-azonosító idegen szülő alatt",
  "param:recId": "5.2/1: az ajánlás-azonosító idegen akváriumon",
  // body fields that are not another account's row
  "body:clientOperationId":
    "a hívó saját ismétlés-kulcsa; a visszajátszás az engedélyezett akvárium ALATT keres (reefclub-aquariums.service occasionByOperation, reefclub-doses.service)",
  "body:productId":
    "katalógus-termék, nem fiók sora; a listán nem szereplő tiltott (reefclub-dose-rules.spec: a listán nem szereplő termék azonosítója tiltott)",
};

interface Found {
  where: string;
  key: string;
}

type Ctor = new (...args: never[]) => unknown;

/** The field names of a validation schema, nested schemas included (`@ValidateNested` + `@Type`). */
function schemaFields(target: Ctor, seen = new Set<Ctor>()): string[] {
  if (seen.has(target)) return [];
  seen.add(target);
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(
    target,
    "",
    true,
    false,
  );
  const names = [...new Set(metadatas.map((m) => m.propertyName))];
  const nested = names.flatMap((name) => {
    const type = defaultMetadataStorage.findTypeMetadata(target, name);
    const inner = type?.typeFunction?.() as Ctor | undefined;
    return inner && typeof inner === "function" && inner !== Object
      ? schemaFields(inner, seen).map((n) => `${name}.${n}`)
      : [];
  });
  return [...names, ...nested];
}

function requestIds(): Found[] {
  const module = ReefClubModule.forRoot({});
  const controllers = (module.controllers ?? []) as Ctor[];
  assert.ok(controllers.length >= 5, `${controllers.length} vezérlő`);
  const found: Found[] = [];
  let fields = 0;
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const method of Object.getOwnPropertyNames(prototype)) {
      if (method === "constructor") continue;
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        controller,
        method,
      ) ?? {}) as Record<string, { index: number; data?: unknown }>;
      const types = (Reflect.getMetadata(
        "design:paramtypes",
        prototype,
        method,
      ) ?? []) as Ctor[];
      for (const [key, arg] of Object.entries(args)) {
        const kind = Number(key.split(":")[0]);
        const where = `${controller.name}.${method}`;
        const place =
          kind === RouteParamtypes.BODY
            ? "body"
            : kind === RouteParamtypes.QUERY
              ? "query"
              : kind === RouteParamtypes.PARAM
                ? "param"
                : null;
        if (!place) continue;
        if (typeof arg.data === "string") {
          // a named parameter: @Param("id"), @Query("cursor"), @Body("x")
          fields += 1;
          found.push({ where, key: `${place}:${arg.data}` });
          continue;
        }
        const schema = types[arg.index];
        if (!schema || schema === Object || schema === String) continue;
        for (const name of schemaFields(schema)) {
          fields += 1;
          found.push({ where, key: `${place}:${name.split(".").pop()}` });
        }
      }
    }
  }
  assert.ok(fields >= 10, `${fields} kérés-mező: a beolvasás nem lát semmit`);
  return found;
}

describe("5.2/10: minden azonosító-mező a ReefClub kéréseiben a mátrixban áll", () => {
  it("egy új azonosító-jellegű mező (törzs, lekérdezés, útvonal) piros, amíg nincs mérési helye", () => {
    const unknown = requestIds()
      .filter((f) => ID_LIKE.test(f.key.split(":")[1]!))
      .filter((f) => !(f.key in KNOWN))
      .map((f) => `${f.where} ${f.key}`);
    assert.deepEqual(unknown, []);
  });

  it("a lista nem rothad: minden felsorolt mező létezik még", () => {
    const present = new Set(requestIds().map((f) => f.key));
    assert.deepEqual(
      Object.keys(KNOWN).filter((key) => !present.has(key)),
      [],
    );
  });
});
