import { Body, Controller, Put, Param } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AttributeSetAdminService } from "./attribute-set-admin.service.js";
import { SetProductAttributeSetDto } from "./dto/attribute-set.dto.js";

/**
 * A TERMEK ATTRIBUTUM-KESZLETE (S1, kartya 8639ac2a; acrobot 41628/41631): `PUT
 * /products/:id/attribute-set`, KULON jogosultsaggal. NEM a termek-szerkesztes (`PATCH
 * /products/:id`) UNAS-guardjanak lazitasa: az orzo a vegponton all, mint a katalogus-gazda
 * atvetelenel; az `UpdateProductDto` tovabbra sem fogad `attributeSetId`-t, es egy UNAS-gazdaju
 * termek barmely mas mezoje tovabbra is 409. A kotes OS-oldali metaadat, a UNAS-szinkron nem irja,
 * a bolti vetitesbe nem kerul, es a termek `updatedAt`-jet sem leptetit (nem indit vetitest).
 */
@Controller("products/:id/attribute-set")
export class ProductAttributeSetController {
  constructor(private readonly admin: AttributeSetAdminService) {}

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_ATTRIBUTE_SET_MANAGE)
  set(@Param("id") id: string, @Body() input: SetProductAttributeSetDto) {
    return this.admin.setProductAttributeSet(id, input.attributeSetId);
  }
}
