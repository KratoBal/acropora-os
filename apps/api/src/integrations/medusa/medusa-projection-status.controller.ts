import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  MedusaProjectionScheduler,
  type ProjectionRoundStatus,
} from "./medusa-projection.scheduler.js";

/**
 * A VETÍTŐ SORÁNAK ÁLLAPOTA, CSAK OLVASVA (ca422e92, acrobot 45402). A flotta a
 * teszt API naplóját és környezetét nem látja, ezért az, hogy egy termékcsoport
 * (például a kifutott jelölőre váró inaktívak) sorra kerül-e, eddig nem volt
 * mérhető. Csak számok és időpontok, termék-azonosító, név és titok nélkül, és
 * nem dolgozik (a kör maga írja a memóriába; adatbázist nem olvas, vetítést nem
 * indít). Egy újraindulás után az utolsó kör `null`, amíg az első le nem fut.
 *
 * JOG MÖGÖTT, NEM NYILVÁNOS (barracuda, #2340 review): a végpont az éles API-n is
 * áll, és a kör gyakorisága, meg hogy hány termék esik akciós határra, ténybeli
 * vagy márkaváltozásra, üzleti mozgás. A `health/inventory/diagnostics` jogát
 * kapja; a flotta a teszten a smoke fiókkal olvassa
 * (`agents/nautilus/scripts/vetito-sor-stage.mjs`).
 */
@Controller("health/medusa-projection")
export class MedusaProjectionStatusController {
  constructor(private readonly scheduler: MedusaProjectionScheduler) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  status(): ProjectionRoundStatus {
    return this.scheduler.allapot();
  }
}
