import { describe, expect, it } from "vitest";

import { equipmentTitle } from "./aquarium-equipment-title";

describe("equipmentTitle (a berendezés sorának címe)", () => {
  it("a gyártó és a típus ` · ` jellel áll", () => {
    expect(equipmentTitle({ manufacturer: "Minta", model: "T5" })).toBe(
      "Minta · T5",
    );
  });

  it("a hiányzó gyártó kimarad, nem kötőjel áll helyette", () => {
    expect(equipmentTitle({ manufacturer: null, model: "T5" })).toBe("T5");
    expect(equipmentTitle({ model: "T5" })).toBe("T5");
    expect(equipmentTitle({ manufacturer: "  ", model: "T5" })).toBe("T5");
    expect(equipmentTitle({ manufacturer: "", model: "T5" })).toBe("T5");
  });

  it("a hiányzó típus is kimarad, és egyik nélkül a cím üres", () => {
    expect(equipmentTitle({ manufacturer: "Minta", model: null })).toBe(
      "Minta",
    );
    expect(equipmentTitle({ manufacturer: null, model: null })).toBe("");
    expect(equipmentTitle({})).toBe("");
  });
});
