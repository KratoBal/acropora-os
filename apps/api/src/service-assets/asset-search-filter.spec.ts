import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetSearchWhere } from "./asset-search-filter.js";

describe("a szöveges kereső mezőlistája", () => {
  it("kereső szöveg nélkül üres feltétel", () => {
    assert.deepEqual(assetSearchWhere(undefined), {});
  });

  it("üres szövegre is üres feltétel", () => {
    assert.deepEqual(assetSearchWhere(""), {});
  });

  /**
   * EZ AZ ALLITAS ORZI AZ ELFOGADASI FELTETELT (kanban 8c77cf3e): aki a
   * villanyszekrenynel a kodot latja, a keresobe irva meg kell talalnia az
   * eszkozt. A `deepEqual`-lel egyezo MASIK mezo (pl. `partnerInternalCode`)
   * NEM eleg: az `electricalCode` mezonek SAJAT tagja kell legyen az OR
   * listaban, kulonben egy kesobbi atszervezes csendben elejtheti, es a
   * lista-alapu vedelem pont azt nem venne eszre.
   */
  it("az OR lista tartalmazza az electricalCode mezőt", () => {
    const { OR } = assetSearchWhere("30M");
    assert.ok(Array.isArray(OR), "a keresés OR listaban all");
    assert.ok(
      OR.some(
        (ag) =>
          "electricalCode" in ag &&
          ag.electricalCode &&
          typeof ag.electricalCode === "object" &&
          "contains" in ag.electricalCode &&
          ag.electricalCode.contains === "30M" &&
          ag.electricalCode.mode === "insensitive",
      ),
      "az electricalCode ágnak contains+insensitive alakban kell szerepelnie",
    );
  });
});
