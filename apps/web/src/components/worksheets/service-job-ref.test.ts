import { describe, expect, it } from "vitest";

import { serviceJobRef } from "./service-job-ref";

/*
  A MUNKALAP "JEGY" LINKJE A KARBANTARTÁSI LAPRA A KARBANTARTÁSI LAPRA VISZ (Balázs, 2026-11-18; acrobot 55785): a karbantartási lap nem
  hibajegy, a felirata sem az. MI PIROSÍT: ha egy MAINTENANCE jegy a hibajegyek útvonalára visz, vagy "Hibajegy" a felirata; ha a
  hibajegy (REPAIR, vagy a fajta nélküli régi válasz) elveszíti a sajátját.
*/
describe("serviceJobRef", () => {
  it("a karbantartási lap a Karbantartás alatt áll, a saját feliratával", () => {
    expect(serviceJobRef({ id: "j1", kind: "MAINTENANCE" })).toEqual({
      href: "/szerviz/karbantartas/j1",
      label: "Karbantartási lap",
    });
  });

  it("a hibajegy, és a fajta nélküli régi válasz, a hibajegyek alatt marad", () => {
    expect(serviceJobRef({ id: "j2", kind: "REPAIR" })).toEqual({
      href: "/szerviz/hibajegyek/j2",
      label: "Hibajegy",
    });
    expect(serviceJobRef({ id: "j3" })).toEqual({
      href: "/szerviz/hibajegyek/j3",
      label: "Hibajegy",
    });
  });
});
