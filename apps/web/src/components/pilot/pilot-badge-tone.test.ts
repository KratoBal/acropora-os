import { describe, expect, it } from "vitest";
import {
  partnerStatusBadgeVariant,
  pilotBadgeVariantForTone,
} from "@acropora/ui";

/**
 * A KÖZÖS TONE -> PILOT VARIANS SZABÁLY, ÉS A JEGY-KIVÉTEL -- MÉRVE, NEM
 * OLVASVA. Lásd `packages/ui/src/pilot-badge-tone.ts` fejlécét az indokért
 * (acrobot döntése, msg 23529, PR #1114).
 *
 * EZ A TESZT NEM `apps/partner`-BEN ÁLL, JÓLLEHET ANNAK A HIBAJEGY-LISTÁJA
 * AZ ELSŐ FOGYASZTÓ: a `pilot-badge-tone.ts` a `@acropora/ui` publikus
 * belépőjén (`index.ts`) keresztül érhető el, az pedig a csomag TELJES JSX-
 * és DOM-függő felületét is behúzza. `apps/partner`-nek a `tsconfig.test.json`
 * (lásd a fejlécét) szándékosan NEM ismer se `--jsx`-et, se DOM-libet -- ott
 * a teszt-fordítás emiatt elhasalna, akkor is, ha ez a modul maga tiszta
 * függvény. `apps/web` vitestje ezt korlátozás nélkül kezeli (ugyanez a
 * minta, mint `theme-preference.test.ts`-nél).
 */
describe("pilotBadgeVariantForTone", () => {
  it("az alapszabályt adja mind a hat tonusra", () => {
    expect(pilotBadgeVariantForTone("green")).toBe("teal");
    expect(pilotBadgeVariantForTone("purple")).toBe("blue");
    expect(pilotBadgeVariantForTone("amber")).toBe("amber");
    expect(pilotBadgeVariantForTone("red")).toBe("danger");
    expect(pilotBadgeVariantForTone("blue")).toBe("blue");
    expect(pilotBadgeVariantForTone("neutral")).toBe("default");
  });
});

describe("partnerStatusBadgeVariant", () => {
  /**
   * A NÉGY ÁLLAPOT MIND A NÉGY EGYMÁSTÓL KÜLÖNBÖZŐ VARIÁNST KAP -- ez a
   * mérce, nem az egyes értékek: az alapszabály önmagában a NEW-ot és az
   * IN_PROGRESS-t ugyanarra a kékre vinné (purple -> blue ütközne a NEW
   * saját blue-jával), a kivétel pontosan ezt oldja fel.
   */
  it("mind a négy jegy-állapot külön pilot variánst kap", () => {
    const variants = [
      partnerStatusBadgeVariant("NEW"),
      partnerStatusBadgeVariant("IN_PROGRESS"),
      partnerStatusBadgeVariant("COMPLETED"),
      partnerStatusBadgeVariant("CLOSED"),
    ];
    expect(new Set(variants).size).toBe(4);
  });

  it("a NEW blue-t, a COMPLETED tealt, a CLOSED defaultot kap (az alapszabály szerint)", () => {
    expect(partnerStatusBadgeVariant("NEW")).toBe("blue");
    expect(partnerStatusBadgeVariant("COMPLETED")).toBe("teal");
    expect(partnerStatusBadgeVariant("CLOSED")).toBe("default");
  });

  it("az IN_PROGRESS a kivétellel ambert kap, nem az alapszabály szerinti blue-t", () => {
    expect(partnerStatusBadgeVariant("IN_PROGRESS")).toBe("amber");
  });
});
