import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BLOCKED_NOT_LOADED,
  BLOCKED_OTHER_TEMPLATE,
  groupRowStates,
  groupSelectionReady,
  type TemplateListState,
} from "./group-selection";

/*
  A CSOPORTOS KIJELÖLÉS A LISTÁN (Balázs, 2026-11-17: „nincs közös üzemeltetési sablonja”). MI PIROSIT: ha az első kijelölés után egy
  közös sablon nélküli eszköz jelölhető maradna; ha egy közös sablonú eszköz kiesne; ha a kijelölt eszköz nem lenne kivehető; ha egy még
  töltődő vagy sikertelen sablon-lista jelölhetőnek látszana; ha a csoportos gomb közös sablon nélkül aktív lenne.
*/
const ids = ["a", "b", "c", "d"];
const t = (...templateIds: string[]) => templateIds.map((id) => ({ id }));
const states = (
  selected: string[],
  templates: Record<string, TemplateListState>,
) => groupRowStates({ assetIds: ids, selected, templates });

describe("groupRowStates", () => {
  it("semmi sincs kijelölve: mindenki jelölhető, a sablonlistát nem is kell ismerni", () => {
    const result = states([], {});
    for (const id of ids) assert.deepEqual(result[id], { kind: "free" });
  });

  it("az első kijelölés után csak a közös sablonú jelölhető, a többi indokot kap, a kijelölt kivehető", () => {
    const result = states(["a"], {
      a: t("homok"),
      b: t("homok", "mas"),
      c: t("uv"),
      d: t("mas"),
    });
    assert.deepEqual(result.a, { kind: "selected" });
    assert.deepEqual(result.b, { kind: "free" });
    assert.deepEqual(result.c, {
      kind: "blocked",
      reason: BLOCKED_OTHER_TEMPLATE,
    });
    assert.deepEqual(result.d, {
      kind: "blocked",
      reason: BLOCKED_OTHER_TEMPLATE,
    });
  });

  it("két kijelölt: a KÖZÖS sablon szűkít (nem az első eszközé egyedül)", () => {
    const templates = {
      a: t("homok", "uv"),
      b: t("homok"),
      c: t("uv"),
      d: t("homok", "uv"),
    };
    const result = states(["a", "b"], templates);
    assert.deepEqual(result.c, {
      kind: "blocked",
      reason: BLOCKED_OTHER_TEMPLATE,
    });
    assert.deepEqual(result.d, { kind: "free" });
  });

  it("CONTROL: egy még töltődő lista nem jelölhető jelölhetőként, és ha a kijelölté töltődik, mindenki töltődik", () => {
    assert.deepEqual(states(["a"], { a: t("x"), b: undefined }).b, {
      kind: "loading",
    });
    assert.deepEqual(states(["a"], { b: t("x") }).b, { kind: "loading" });
  });

  it("CONTROL: a sikertelen lista nem jelölhető (a sajátja, vagy egy kijelölté)", () => {
    assert.deepEqual(states(["a"], { a: t("x"), b: "failed" }).b, {
      kind: "blocked",
      reason: BLOCKED_NOT_LOADED,
    });
    assert.deepEqual(states(["a"], { a: "failed", b: t("x") }).b, {
      kind: "blocked",
      reason: BLOCKED_NOT_LOADED,
    });
  });
});

describe("groupSelectionReady", () => {
  it("két kijelölt közös sablonnal: aktív", () => {
    assert.equal(
      groupSelectionReady({
        selected: ["a", "b"],
        templates: { a: t("x"), b: t("x", "y") },
      }),
      true,
    );
  });

  it("CONTROL: kevesebb mint két kijelölt, közös sablon nélkül, hiányzó vagy sikertelen lista: nem aktív", () => {
    assert.equal(
      groupSelectionReady({ selected: ["a"], templates: { a: t("x") } }),
      false,
    );
    assert.equal(
      groupSelectionReady({
        selected: ["a", "b"],
        templates: { a: t("x"), b: t("y") },
      }),
      false,
    );
    assert.equal(
      groupSelectionReady({ selected: ["a", "b"], templates: { a: t("x") } }),
      false,
    );
    assert.equal(
      groupSelectionReady({
        selected: ["a", "b"],
        templates: { a: t("x"), b: "failed" },
      }),
      false,
    );
  });
});
