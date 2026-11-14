import { describe, expect, it } from "vitest";

import { grossFromNet, netFromGross } from "./quote-gross-price";

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
