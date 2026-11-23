import { describe, expect, it } from "vitest";

import {
  centsToDecimal,
  grossFromNet,
  itemLineAmounts,
  netFromGross,
} from "./quote-gross-price";

describe("nettó és bruttó egységár", () => {
  it("a nettóból a bruttó két tizedesre, fél felfelé", () => {
    expect(grossFromNet("1000", "27")).toBe("1270");
    expect(grossFromNet("787.4016", "27")).toBe("1000");
    expect(grossFromNet("0.3333", "27")).toBe("0.42");
    expect(grossFromNet("100", "5")).toBe("105");
    expect(grossFromNet("100", "0")).toBe("100");
  });

  it("a bruttóból a nettó négy tizedesre", () => {
    expect(netFromGross("1270", "27")).toBe("1000");
    expect(netFromGross("1000", "27")).toBe("787.4016");
    expect(netFromGross("999", "27")).toBe("786.6142");
    expect(netFromGross("105", "5")).toBe("100");
    expect(netFromGross("1000", "0")).toBe("1000");
  });

  it("vesszőt és pontot is elfogad (az API is mindkettőt)", () => {
    expect(netFromGross("1000,50", "27")).toBe(netFromGross("1000.50", "27"));
    expect(grossFromNet("787,4016", "27")).toBe("1000");
  });

  it("a bruttóból visszaszámolt nettó az egész forintos bruttót adja vissza (1-2000 Ft, 27 és 5 %)", () => {
    for (const vat of ["27", "5", "18"])
      for (let gross = 1; gross <= 2000; gross += 1) {
        const net = netFromGross(String(gross), vat)!;
        expect(grossFromNet(net, vat), `${gross} @ ${vat}`).toBe(String(gross));
      }
  });

  it("ami nem szám, arra null jön, nem kivétel és nem NaN", () => {
    expect(grossFromNet("", "27")).toBeNull();
    expect(grossFromNet("12a", "27")).toBeNull();
    expect(netFromGross("1000", "")).toBeNull();
    expect(netFromGross("1,2,3", "27")).toBeNull();
    expect(netFromGross("1000", "-100")).toBeNull();
  });

  it("negatív összeg (jóváírás) is számolható", () => {
    expect(netFromGross("-1270", "27")).toBe("-1000");
    expect(grossFromNet("-1000", "27")).toBe("-1270");
  });
});

describe("egy tétel sora nettóban és bruttóban", () => {
  it("1 db, 10 000 Ft nettó, 27 %: bruttó 12 700", () => {
    const line = itemLineAmounts("1", "10000", "27")!;
    expect([
      centsToDecimal(line.netCents),
      centsToDecimal(line.grossCents),
    ]).toEqual(["10000", "12700"]);
  });

  it("több darab: a bruttó a sor nettójából megy, egyszer kerekítve (3 db, 3,3333 Ft nettó, 27 %)", () => {
    const line = itemLineAmounts("3", "3.3333", "27")!;
    // nettó 9,9999 -> 10,00; bruttó 9,9999 * 1,27 = 12,699873 -> 12,70
    expect([
      centsToDecimal(line.netCents),
      centsToDecimal(line.grossCents),
    ]).toEqual(["10", "12.7"]);
  });

  it("tört mennyiség és vesszős szám", () => {
    const line = itemLineAmounts("2,5", "1000,50", "5")!;
    expect([
      centsToDecimal(line.netCents),
      centsToDecimal(line.grossCents),
    ]).toEqual(["2501.25", "2626.31"]);
  });

  it("ami nem szám, arra null jön", () => {
    expect(itemLineAmounts("", "1000", "27")).toBeNull();
    expect(itemLineAmounts("1", "x", "27")).toBeNull();
    expect(itemLineAmounts("1", "1000", "")).toBeNull();
  });

  it("negatív sor (jóváírás tétel) is számolható", () => {
    const line = itemLineAmounts("1", "-1000", "27")!;
    expect([
      centsToDecimal(line.netCents),
      centsToDecimal(line.grossCents),
    ]).toEqual(["-1000", "-1270"]);
  });
});
