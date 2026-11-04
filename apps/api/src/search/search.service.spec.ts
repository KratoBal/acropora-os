import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasPermission,
  PERMISSIONS,
  USER_ROLES,
  type AuthenticatedUser,
  type UserRole,
} from "@acropora/types";

import type { AquariumsService } from "../aquariums/aquariums.service.js";
import type { InvoiceSearchService } from "../billing/invoice-search.service.js";
import type { WebshopOrdersService } from "../orders/webshop-orders/webshop-orders.service.js";
import type { ProductService } from "../products/product.service.js";
import type { QuotesService } from "../quotes/quotes.service.js";
import type { ServiceAssetsService } from "../service-assets/service-assets.service.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { SuppliersService } from "../suppliers/suppliers.service.js";
import type { WorksheetsService } from "../worksheets/worksheets.service.js";
import { SearchService } from "./search.service.js";

const user = (
  role: UserRole,
  customerId: string | null = null,
): AuthenticatedUser => ({
  id: `${role.toLowerCase()}-user`,
  email: `${role.toLowerCase()}@acropora.hu`,
  displayName: role,
  role,
  customerId,
  supplierId: null,
});

/** how many times the invoice search ran: a group the user may not see must not even be queried */
let invoiceCalls = 0;
/** how many times the quote list ran, and for which users */
let quoteCalls = 0;
/** the Medusa order list: how often it ran, and what it does */
let orderCalls = 0;
/** the product list: how often it ran */
let productCalls = 0;
let orderList: () => Promise<unknown> = async () => ({
  items: [
    {
      id: "order/1",
      displayId: 1042,
      customer: { name: "Kovács Anna", email: "anna@example.invalid" },
      total: 18900,
      currency: "HUF",
      invoiceNumber: "KI-2026/9",
    },
    {
      id: "order-2",
      displayId: 1043,
      customer: { name: null, email: "guest@example.invalid" },
      total: 5090.5,
      currency: "HUF",
      invoiceNumber: null,
    },
  ],
});

const search = (
  overrides: Record<string, unknown> = {},
  environment: NodeJS.ProcessEnv = {},
) =>
  new SearchService(
    {
      list: async () => ({
        items: [
          {
            id: "ticket-own",
            title: "Saját hiba",
            jobNumber: "HJ-1",
            customerName: "Saját partner",
            departmentPath: ["Telephely"],
          },
        ],
      }),
      ...overrides,
    } as unknown as ServiceJobsService,
    {
      list: async () => ({
        items: [
          {
            id: "worksheet-own",
            subject: "Saját munkalap",
            number: "ML-1",
            customerName: "Saját partner",
            departmentCode: "TEL",
            departmentPath: ["Telephely"],
          },
        ],
      }),
    } as unknown as WorksheetsService,
    {
      list: async () => ({
        items: [
          {
            id: "asset-own",
            name: "Saját eszköz",
            assetNumber: "E-1",
            owner: { displayName: "Saját partner" },
          },
        ],
      }),
    } as unknown as ServiceAssetsService,
    {
      list: async () => ({
        items: [{ id: "partner-own", name: "Saját partner", code: "SAJAT" }],
      }),
    } as unknown as SuppliersService,
    {
      list: async () => ({
        items: [
          {
            id: "aquarium-own",
            name: "Saját akvárium",
            aquariumNumber: "A-1",
            customerName: "Saját partner",
          },
        ],
      }),
    } as unknown as AquariumsService,
    {
      search: async () => {
        invoiceCalls += 1;
        return [
          {
            id: "document:inv-1",
            title: "SZ-2026/1",
            subtitle: "Kimenő számla · Vevő Kft. · 12 700 Ft",
            path: "/penzugy/szamlazas/inv-1",
          },
        ];
      },
    } as unknown as InvoiceSearchService,
    {
      list: async (
        _user: unknown,
        _page: number,
        pageSize: number,
        filter: { q?: string },
      ) => {
        quoteCalls += 1;
        assert.equal(pageSize, 5);
        assert.equal(filter.q, "ajánlat");
        return {
          items: [
            {
              id: "quote-1",
              quoteNumber: "AJ-2026-0001",
              title: "Nano akvárium",
              customerName: "Vevő Kft.",
              latestVersion: { netTotal: "253000.0000", currency: "HUF" },
            },
            {
              id: "quote-2",
              quoteNumber: "AJ-2026-0002",
              title: "Üres ajánlat",
              customerName: null,
              latestVersion: null,
            },
          ],
        };
      },
    } as unknown as QuotesService,
    {
      list: async (query: { q?: string; page?: number; pageSize?: number }) => {
        orderCalls += 1;
        assert.equal(query.page, 1);
        assert.equal(query.pageSize, 5);
        assert.ok(query.q);
        return orderList();
      },
    } as unknown as WebshopOrdersService,
    {
      listProducts: async (query: {
        search?: string;
        page?: number;
        pageSize?: number;
      }) => {
        productCalls += 1;
        assert.equal(query.page, 1);
        assert.equal(query.pageSize, 5);
        assert.ok(query.search);
        return {
          items: [
            {
              id: "prod/1",
              name: "Aquaforest Reef Salt 25 kg",
              primarySku: "AF-SALT-25",
              brand: { id: "b1", name: "Aquaforest" },
            },
            {
              id: "prod-2",
              name: "Névtelen termék",
              primarySku: null,
              brand: null,
            },
          ],
        };
      },
    } as unknown as ProductService,
    environment,
  );

describe("SearchService", () => {
  for (const [role, expectedGroups] of [
    [
      "OWNER",
      [
        "aquariums",
        "assets",
        "invoices",
        "orders",
        "partners",
        "products",
        "tickets",
        "worksheets",
      ],
    ],
    ["SERVICE", ["aquariums", "assets", "partners", "tickets", "worksheets"]],
    ["PARTNER_SERVICE", ["aquariums", "assets", "tickets", "worksheets"]],
  ] as const) {
    it(`${role} pontosan a látható listaoldalai keresési csoportjait kapja`, async () => {
      const result = await search().search("saját", user(role));
      assert.deepEqual(Object.keys(result).sort(), expectedGroups);
    });
  }

  it("két karakternél rövidebb keresés üres válasz", async () => {
    assert.deepEqual(await search().search("a", user("OWNER")), {});
    assert.deepEqual(await search().search(" ", user("OWNER")), {});
  });

  it("a partner nem kapja meg a másik partner sorát: a hibajegy saját listájának hatóköre marad érvényben", async () => {
    let listUser: AuthenticatedUser | undefined;
    const service = search({
      list: async (_query: unknown, requestedUser: AuthenticatedUser) => {
        listUser = requestedUser;
        return {
          items: [
            {
              id: "ticket-own",
              title: "Saját hiba",
              jobNumber: "HJ-1",
              customerName: "Saját partner",
              departmentPath: ["Telephely"],
            },
          ],
        };
      },
    });

    const result = await service.search(
      "hiba",
      user("PARTNER_SERVICE", "customer-own"),
    );

    assert.equal(listUser?.customerId, "customer-own");
    assert.deepEqual(
      result.tickets?.map((item) => item.id),
      ["ticket-own"],
    );
    assert.equal(
      result.tickets?.some((item) => item.id === "ticket-other"),
      false,
      "a partner nem látja a másik partner hibajegysorát",
    );
  });

  /*
    A SZÁMLA-CSOPORT KAPUJA (T2.2, 1. szelet). MI PIROSÍT: ha a csoport egy `billing.view` nélküli
    szerepnek is megjelenne; ha a számla-keresés LEFUTNA a csoportot nem látó felhasználónál (a
    találat nem látszana, de a lekérdezés és a darabszám igen: a kapu a lekérdezés előtt áll); ha
    egy szerepnél a csoport és a jog elválna.
  */
  it("the invoices group is present for exactly the roles that hold billing.view, and its search never runs for the others", async () => {
    for (const role of USER_ROLES) {
      invoiceCalls = 0;
      const subject = user(role);
      const result = await search().search("számla", subject);
      const allowed = hasPermission(subject, PERMISSIONS.BILLING_VIEW);
      assert.equal("invoices" in result, allowed, role);
      assert.equal(invoiceCalls, allowed ? 1 : 0, role);
    }
  });

  it("returns the invoice items as the invoice search gave them", async () => {
    const result = await search().search("számla", user("OWNER"));
    assert.deepEqual(
      result.invoices?.map((i) => i.id),
      ["document:inv-1"],
    );
  });

  /*
    AZ AJÁNLAT-CSOPORT A MENÜ SZERINT LÁTSZIK (acrobot 41762, T2.2 2. szelet): a menüpont feature-höz
    kötött (`QUOTES_ENABLED`), és a keresésnek a felhasználó kiszolgált feature-jeit kell átadnia.
    MI PIROSÍT: ha az ajánlat feature NÉLKÜL is megjelenne (a menü nem mutatja, a keresés igen); ha a
    feature mellett a `quotes.view` nélküli szerepnek is megjelenne; ha a pilot módban nem csak a
    felsorolt felhasználó kapná; ha a feature-t a keresés nem adná át, és az ajánlat SOHA nem
    jelenne meg (a naiv `canSee("quotes")` hibája); ha a lista a csoportot nem látó felhasználónál
    is lefutna.
  */
  it("quotes are absent without the feature, even for a role that holds quotes.view, and the list never runs", async () => {
    for (const environment of [
      {},
      { QUOTES_ENABLED: "off" },
      { QUOTES_ENABLED: "pilot" },
    ]) {
      for (const role of USER_ROLES) {
        quoteCalls = 0;
        const result = await search({}, environment).search(
          "ajánlat",
          user(role),
        );
        assert.equal(
          "quotes" in result,
          false,
          `${role} ${JSON.stringify(environment)}`,
        );
        assert.equal(quoteCalls, 0, `${role} ${JSON.stringify(environment)}`);
      }
    }
  });

  it("with the feature on, quotes appear for exactly the roles that hold quotes.view", async () => {
    for (const role of USER_ROLES) {
      quoteCalls = 0;
      const subject = user(role);
      const result = await search({}, { QUOTES_ENABLED: "on" }).search(
        "ajánlat",
        subject,
      );
      const allowed = hasPermission(subject, PERMISSIONS.QUOTES_VIEW);
      assert.equal("quotes" in result, allowed, role);
      assert.equal(quoteCalls, allowed ? 1 : 0, role);
    }
  });

  it("in pilot mode only the listed user sees quotes", async () => {
    const owner = user("OWNER");
    const environment = {
      QUOTES_ENABLED: "pilot",
      QUOTES_PILOT_USER_IDS: owner.id,
    };
    assert.equal(
      "quotes" in (await search({}, environment).search("ajánlat", owner)),
      true,
    );
    assert.equal(
      "quotes" in
        (await search({}, environment).search("ajánlat", user("ADMIN"))),
      false,
    );
  });

  it("maps a quote to its title, number, customer and net total, and opens it on its page", async () => {
    const result = await search({}, { QUOTES_ENABLED: "on" }).search(
      "ajánlat",
      user("OWNER"),
    );
    assert.deepEqual(
      result.quotes?.map((q) => [q.id, q.title, q.path]),
      [
        ["quote-1", "Nano akvárium", "/ajanlatok/quote-1"],
        ["quote-2", "Üres ajánlat", "/ajanlatok/quote-2"],
      ],
    );
    assert.match(
      result.quotes![0]!.subtitle,
      /^AJ-2026-0001 · Vevő Kft\. · 253\s000\sFt$/,
    );
    // no customer and no version: the number alone
    assert.equal(result.quotes![1]!.subtitle, "AJ-2026-0002");
  });

  /*
    A RENDELÉS-CSOPORT (T2.2, 3. szelet): a Medusa-rendelések listája, `orders.view` kapuval, és KÜLSŐ
    forrásból olvas. MI PIROSÍT: ha a csoport a jog nélküli szerepnek is megjelenne, vagy a
    lista lefutna nekik; ha a webshop hibája (elérhetetlen) az egész keresést elvinné; ha a
    hibás csoport helyett üres tömb jelenne meg (a „nincs találat” és a „nem ért el” két külön
    állítás); ha a találat a rendelés azonosítóját nem kódolva tenné az útvonalba.
  */
  it("orders are present for exactly the roles that hold orders.view, and the list never runs for the others", async () => {
    for (const role of USER_ROLES) {
      orderCalls = 0;
      const subject = user(role);
      const result = await search().search("rendelés", subject);
      const allowed = hasPermission(subject, PERMISSIONS.ORDERS_VIEW);
      assert.equal("orders" in result, allowed, role);
      assert.equal(orderCalls, allowed ? 1 : 0, role);
    }
  });

  it("a webshop that cannot be reached drops ONLY the orders group: the other groups still come, and the group is absent, not empty", async () => {
    const original = orderList;
    orderList = async () => {
      throw new Error("A webshop nem adta ki a rendeléseket (HTTP 503).");
    };
    try {
      const result = await search().search("rendelés", user("OWNER"));
      assert.equal("orders" in result, false);
      assert.ok(result.invoices?.length, "the other groups are intact");
      assert.ok(result.tickets?.length, "the other groups are intact");
    } finally {
      orderList = original;
    }
  });

  it("maps an order to its number, customer, total and invoice, and opens it on its page (id encoded)", async () => {
    const result = await search().search("rendelés", user("OWNER"));
    assert.deepEqual(
      result.orders?.map((o) => [o.id, o.title, o.path]),
      [
        ["order/1", "Rendelés #1042", "/webshop/rendelesek/order%2F1"],
        ["order-2", "Rendelés #1043", "/webshop/rendelesek/order-2"],
      ],
    );
    assert.match(
      result.orders![0]!.subtitle,
      /^Kovács Anna · 18\s900\sFt · KI-2026\/9$/,
    );
    // a guest without a name shows the e-mail; no invoice number leaves the part out
    assert.match(
      result.orders![1]!.subtitle,
      /^guest@example\.invalid · 5\s?090,50\sFt$/,
    );
  });

  /*
    A TERMÉK-CSOPORT (T2.2, 4. szelet): a belső termékkatalógus listája, `products.view` kapuval. MI
    PIROSÍT: ha a csoport a jog nélküli szerepnek is megjelenne, vagy a lista lefutna nekik; ha a lista
    nem 5 elemű, első oldalas lekérdezést kapna; ha a találat útvonalában a termék azonosítója nem
    kódolt; ha a cikkszám vagy a márka hiánya "null" feliratot írna a sorba.
  */
  it("products are present for exactly the roles that hold products.view, and the list never runs for the others", async () => {
    for (const role of USER_ROLES) {
      productCalls = 0;
      const subject = user(role);
      const result = await search().search("só", subject);
      const allowed = hasPermission(subject, PERMISSIONS.PRODUCTS_VIEW);
      assert.equal("products" in result, allowed, role);
      assert.equal(productCalls, allowed ? 1 : 0, role);
    }
  });

  it("maps a product to its name, SKU and brand, and opens it on its page (id encoded); missing parts leave nothing behind", async () => {
    const result = await search().search("só", user("OWNER"));
    assert.deepEqual(
      result.products?.map((p) => [p.id, p.title, p.subtitle, p.path]),
      [
        [
          "prod/1",
          "Aquaforest Reef Salt 25 kg",
          "AF-SALT-25 · Aquaforest",
          "/products/prod%2F1",
        ],
        ["prod-2", "Névtelen termék", "", "/products/prod-2"],
      ],
    );
  });
});
