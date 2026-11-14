import { describe, expect, it } from "vitest";

import {
  defaultOrderLine,
  orderLinePayload,
  orderLineProblem,
} from "./order-lines";

describe("a megrendelőlap darab- és alkalomszáma", () => {
  it("az alap a szerződés darabszáma (a szerver hat tizedesét záró nullák nélkül) és egy alkalom", () => {
    expect(defaultOrderLine({ quantity: "2.000000" })).toEqual({
      quantity: "2",
      occasions: "1",
    });
    expect(defaultOrderLine({ quantity: "2.500000" })).toEqual({
      quantity: "2.5",
      occasions: "1",
    });
    expect(defaultOrderLine({ quantity: "10" })).toEqual({
      quantity: "10",
      occasions: "1",
    });
  });

  it("a hibás értéket megnevezi, a jót átengedi", () => {
    const item = { occasionsPerYear: 4 };
    expect(
      orderLineProblem({ quantity: "1", occasions: "4" }, item),
    ).toBeNull();
    expect(
      orderLineProblem({ quantity: "2,5", occasions: "1" }, item),
    ).toBeNull();
    expect(orderLineProblem({ quantity: "0", occasions: "1" }, item)).toMatch(
      /darabszám/,
    );
    expect(orderLineProblem({ quantity: "", occasions: "1" }, item)).toMatch(
      /darabszám/,
    );
    expect(orderLineProblem({ quantity: "1", occasions: "0" }, item)).toMatch(
      /alkalom/,
    );
    expect(orderLineProblem({ quantity: "1", occasions: "1.5" }, item)).toMatch(
      /alkalom/,
    );
    expect(orderLineProblem({ quantity: "1", occasions: "5" }, item)).toMatch(
      /legfeljebb 4/,
    );
  });

  it("alkalom-keret nélküli tételnél nincs felső korlát a felületen (a szerver dönt)", () => {
    expect(
      orderLineProblem(
        { quantity: "1", occasions: "99" },
        { occasionsPerYear: null },
      ),
    ).toBeNull();
  });

  it("a küldött alak: tizedespont, egész alkalom", () => {
    expect(
      orderLinePayload("i1", { quantity: " 3,5 ", occasions: " 4 " }),
    ).toEqual({
      itemId: "i1",
      quantity: "3.5",
      occasions: 4,
    });
  });
});
