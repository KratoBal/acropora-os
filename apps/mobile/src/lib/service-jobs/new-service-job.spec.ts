import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  newServiceJobProblem,
  PARTNER_ISMERETLEN,
  placementNotice,
  SZALLITO_BIZONYTALAN,
} from "./new-service-job";
import { serviceJobOperationId } from "./types";

/**
 * A KET FIXTURE KULONBSEGE NEM IZLES, HANEM MERT SZABALY.
 *
 * `assetDepartmentRefusal` a szerveren: ALEGYSEG CSAK SZALLITOI eszkozhoz
 * rendelheto (`CUSTOMER_OWNER` az elutasitas vevonel). Vevo gepenel tehat a
 * CIM a pontositas, alegyseg pedig SOSEM all elo. Egy vevo-fixture alegyseggel
 * olyan eszkozt irna le, ami nem letezhet -- es pont azt az agat meresne,
 * amelyiken a valosag soha nem megy vegig.
 */
const vevo = {
  owner: { displayName: "Acropora Kft." },
  ownerType: "CUSTOMER" as const,
  address: { formatted: "1113 Budapest, Bocskai út 77-79." },
};

const szallito = {
  owner: { displayName: "Reef Service Kft." },
  ownerType: "SUPPLIER" as const,
  unit: { name: "Nagy medence", path: ["Biodóm", "Nagy medence"] },
  address: { formatted: "6000 Kecskemét, Fő tér 1." },
};

describe("az új hibajegy űrlapja", () => {
  it("cím nélkül nem megy el", () => {
    assert.match(
      newServiceJobProblem({ title: "  ", description: "" }) ?? "",
      /Írd le/,
    );
  });

  it("a címmel átmegy", () => {
    assert.equal(
      newServiceJobProblem({ title: "Zúg a szivattyú", description: "" }),
      null,
    );
  });

  it("a hosszú mezők elbuknak, a határon állók nem", () => {
    const hosszu = (n: number) => "x".repeat(n);
    assert.equal(
      newServiceJobProblem({ title: hosszu(300), description: hosszu(4000) }),
      null,
    );
    assert.match(
      newServiceJobProblem({ title: hosszu(301), description: "" }) ?? "",
      /300/,
    );
    assert.match(
      newServiceJobProblem({ title: "ok", description: hosszu(4001) }) ?? "",
      /4000/,
    );
  });
});

describe("a képernyő megmondja, hova kerül a jegy", () => {
  it("vevő gépénél a partner és a CÍM látszik", () => {
    const notice = placementNotice(vevo);
    assert.equal(notice.partner, "Acropora Kft.");
    assert.equal(notice.helyszin, "1113 Budapest, Bocskai út 77-79.");
    // NINCS FIGYELMEZTETES: vevo gepen a jegy partnere BIZTOS
    // (`asset.customerId`), es egy mindig ott allo figyelmeztetes ugyanaz,
    // mint ami sosem all ott.
    assert.equal(notice.figyelmeztetes, null);
  });

  it("szállítói gépnél az alegység TELJES útja látszik, nem a cím", () => {
    const notice = placementNotice(szallito);
    assert.equal(notice.helyszin, "Biodóm / Nagy medence");
  });

  /**
   * A CIM A VISSZAESES, NEM A FOSZABALY -- es ezt kulon allitas meri, mert a
   * fenti ketto akkor is zold lenne, ha a fuggveny MINDIG a cimet adna.
   */
  it("alegység nélküli szállítói gépnél a cím marad", () => {
    const notice = placementNotice({ ...szallito, unit: undefined });
    assert.equal(notice.helyszin, "6000 Kecskemét, Fő tér 1.");
  });

  it("ha sem alegység, sem cím nincs, azt KIMONDJA", () => {
    const notice = placementNotice({
      ...szallito,
      unit: undefined,
      address: undefined,
    });
    assert.match(notice.helyszin, /Nincs megadva/);
  });

  /**
   * EZ AZ AZ ALLITAS, AMIT KET MERES IRT, ES A MASODIK ATIRTA AZ ELSOT.
   *
   * Az elso: a lathatosag ket tengelyen all (aki NYITOTTA, es akinek a jegy
   * PARTNERENEL van beosztott helyszine), tehat partner nelkul a kollega nem
   * hibat lat, hanem URES LISTAT. A masodik: a szerver MINDEN eszkozhoz ad
   * tulajdonost (`ASSET_OWNER_MISSING` kulonben), tehat ez az ag kizarolag
   * hianyos MENTETT MASOLATNAL all elo -- a mondat ezert a masolatrol szol.
   */
  it("hiányos másolatnál a másolatról beszél, nem a rendszerről", () => {
    const notice = placementNotice({ ...vevo, owner: undefined });
    assert.equal(notice.figyelmeztetes, PARTNER_ISMERETLEN);
    assert.match(notice.figyelmeztetes ?? "", /kollégáid nem látják/);
    // AMIT NEM SZABAD ALLITANIA: hogy a gepnek nincs partnere. Azt a telefon
    // nem merte meg, es a szerver valasza szerint nem is igaz.
    assert.doesNotMatch(notice.figyelmeztetes ?? "", /nincs partnere/);
    assert.doesNotMatch(notice.partner, /^Nincs partner/);
  });

  /**
   * SZALLITOI GEPNEL NEM ALLITUNK BIZTOSAT, ES EZ NEM OVATOSKODAS.
   *
   * A jegy partnere ilyenkor a szallito TUKOR-sora, ami csak szerviz-jelolt
   * partnerre keletkezik. A telefon ezt nem latja elore -- egy magabiztos
   * "lesz partnere" mondat tehat olyat allitana, amit nem mertunk.
   */
  it("szállítói gépnél a BIZONYTALANSÁGOT mondja ki", () => {
    const notice = placementNotice(szallito);
    assert.equal(notice.partner, "Reef Service Kft.");
    assert.equal(notice.figyelmeztetes, SZALLITO_BIZONYTALAN);
  });

  /**
   * TESTVER-KONTROLL A KET FIGYELMEZTETESRE: a ket mondat KULONBOZIK.
   * Enelkul egy valtozat, ami mindig ugyanazt adja vissza, atmenne mindegyik
   * fenti allitason.
   */
  it("a két figyelmeztetés nem ugyanaz a mondat", () => {
    assert.notEqual(PARTNER_ISMERETLEN, SZALLITO_BIZONYTALAN);
  });
});

describe("a művelet-azonosító", () => {
  it("ugyanabból a bejelentésből ugyanaz", () => {
    const a = serviceJobOperationId({
      originAssetId: "asset-1",
      openedAt: "2026-09-16T22:00:00.000Z",
    });
    const b = serviceJobOperationId({
      originAssetId: "asset-1",
      openedAt: "2026-09-16T22:00:00.000Z",
    });
    assert.equal(a, b);
  });

  /**
   * KET KULON BEJELENTES UGYANARROL A GEPROL KET KULON JEGY.
   *
   * Az idobelyeg nelkul a masodikat a szerver idempotencia-kulcsa ELNYELNE --
   * es a szerelo azt hinne, hogy bejelentette, holott nem.
   */
  it("két külön bejelentés ugyanarról a gépről KÉT azonosító", () => {
    assert.notEqual(
      serviceJobOperationId({
        originAssetId: "asset-1",
        openedAt: "2026-09-16T22:00:00.000Z",
      }),
      serviceJobOperationId({
        originAssetId: "asset-1",
        openedAt: "2026-09-16T22:05:00.000Z",
      }),
    );
  });
});
