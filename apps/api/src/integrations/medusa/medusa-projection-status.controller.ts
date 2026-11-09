import { Controller, Get } from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import {
  MedusaProjectionScheduler,
  type ProjectionRoundStatus,
} from "./medusa-projection.scheduler.js";

/**
 * A VETÍTŐ SORÁNAK ÁLLAPOTA, CSAK OLVASVA (ca422e92, acrobot 45402). A flotta a
 * teszt API naplóját és környezetét nem látja, ezért az, hogy egy termékcsoport
 * (például a kifutott jelölőre váró inaktívak) sorra kerül-e, eddig nem volt
 * mérhető. Nyilvános, mint a `health/inventory/live`: csak számok és időpontok,
 * termék-azonosító, név és titok nélkül, és nem dolgozik (a kör maga írja a
 * memóriába; adatbázist nem olvas, vetítést nem indít). Egy újraindulás után az
 * utolsó kör `null`, amíg az első le nem fut.
 */
@Controller("health/medusa-projection")
export class MedusaProjectionStatusController {
  constructor(private readonly scheduler: MedusaProjectionScheduler) {}

  @Get()
  @Public()
  status(): ProjectionRoundStatus {
    return this.scheduler.allapot();
  }
}
