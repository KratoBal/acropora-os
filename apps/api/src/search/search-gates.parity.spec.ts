import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NAVIGATION_ENTRIES,
  type Permission,
  type SearchGroup,
} from "@acropora/types";

import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from "../auth/decorators/require-permissions.decorator.js";
import { AquariumsController } from "../aquariums/aquariums.controller.js";
import { BillingDocumentReadController } from "../billing/billing-document-read.controller.js";
import { IncomingBillingDocumentsController } from "../billing/incoming-billing-documents.controller.js";
import { ServiceAssetsController } from "../service-assets/service-assets.controller.js";
import { ServiceJobsController } from "../service-jobs/service-jobs.controller.js";
import { WebshopOrdersController } from "../orders/webshop-orders/webshop-orders.controller.js";
import { ProductController } from "../products/product.controller.js";
import { QuotesController } from "../quotes/quotes.controller.js";
import { SuppliersController } from "../suppliers/suppliers.controller.js";
import { WorksheetsController } from "../worksheets/worksheets.controller.js";
import { SEARCH_GROUP_NAVIGATION } from "./search.service.js";

/**
 * A KERESÉS NEM MUTAT OLYAT, AMIT A LISTA 403-MAL ADNA, ÉS NEM REJT OLYAT, AMIT A LISTA MEGAD (T2.2).
 *
 * Minden keresési csoport a menüpontja láthatóságával kapuzott; a lista vezérlője a saját
 * `@RequirePermissions` jogát viseli. A két szabály külön helyen él, és eltérésük kétféleképpen
 * hibás: a keresés kiszivárogtatja a listát, amit a lista elutasítana, vagy elrejti, amit megadna.
 * Ez a teszt a lista ÉLŐ metaadatát olvassa (Nest `getAllAndOverride`: előbb a kezelő, aztán az
 * osztály), nem egy másolt táblát.
 *
 * MI PIROSÍT: egy csoport menüpontja más jogot kér, mint a lista vezérlője; egy vezérlő
 * `RequireAnyPermission`-t kapna (a menüpont egyetlen jogot ismer: az eltérés nem vethető egybe,
 * tehát megáll, nem csendben zöld).
 */
const LISTS: Record<
  SearchGroup,
  Array<{ controller: Function; handler: string }>
> = {
  tickets: [{ controller: ServiceJobsController, handler: "list" }],
  worksheets: [{ controller: WorksheetsController, handler: "list" }],
  assets: [{ controller: ServiceAssetsController, handler: "list" }],
  partners: [{ controller: SuppliersController, handler: "list" }],
  aquariums: [{ controller: AquariumsController, handler: "list" }],
  // a számla csoport KÉT listát fed: a kimenő/külső és a bejövő, mindkettő ugyanazt a jogot kéri
  invoices: [
    { controller: BillingDocumentReadController, handler: "list" },
    { controller: IncomingBillingDocumentsController, handler: "list" },
  ],
  // az ajánlat menüpontja feature-höz kötött is (QUOTES_ENABLED), de a JOG ugyanaz, mint a lista kontrolleréé
  quotes: [{ controller: QuotesController, handler: "list" }],
  // a Medusa-rendelések listája (a UNAS-lista `webshop-orders` menüpontja nem kereshető)
  orders: [{ controller: WebshopOrdersController, handler: "list" }],
  // a termékkatalógus lista kezelője `listProducts`
  products: [{ controller: ProductController, handler: "listProducts" }],
};

function requiredFor(controller: Function, handler: string) {
  const fn = (controller.prototype as Record<string, unknown>)[handler];
  const get = (key: string): Permission[] | undefined =>
    (Reflect.getMetadata(key, fn as object) as Permission[] | undefined) ??
    (Reflect.getMetadata(key, controller) as Permission[] | undefined);
  return {
    all: get(REQUIRED_PERMISSIONS_KEY) ?? [],
    any: get(REQUIRED_ANY_PERMISSIONS_KEY) ?? [],
  };
}

describe("search group gates", () => {
  for (const group of Object.keys(SEARCH_GROUP_NAVIGATION) as SearchGroup[]) {
    it(`${group}: the menu entry asks for the permission every list controller asks for`, () => {
      const entry = NAVIGATION_ENTRIES.find(
        (e) => e.id === SEARCH_GROUP_NAVIGATION[group],
      );
      assert.ok(entry, `no menu entry ${SEARCH_GROUP_NAVIGATION[group]}`);
      assert.equal(
        entry.visibility.kind,
        "permission",
        `${group}: the entry is not a permission rule`,
      );
      const entryPermission = (entry.visibility as { permission: Permission })
        .permission;
      for (const { controller, handler } of LISTS[group]) {
        const required = requiredFor(controller, handler);
        assert.deepEqual(
          required.any,
          [],
          `${controller.name}.${handler} uses an any-of rule`,
        );
        assert.deepEqual(
          required.all,
          [entryPermission],
          `${controller.name}.${handler} asks for ${required.all.join(",")}, the menu entry for ${entryPermission}`,
        );
      }
    });
  }

  it("covers every search group (a new group without a list here is a compile error)", () => {
    assert.deepEqual(
      Object.keys(LISTS).sort(),
      Object.keys(SEARCH_GROUP_NAVIGATION).sort(),
    );
  });
});
