import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopOrderStatusChangeDto } from "./dto/webshop-order-status-change.dto.js";
import { WebshopOrderListQueryDto } from "./dto/webshop-order-list-query.dto.js";
import {
  WebshopOrderLineEditDto,
  lineEditOf,
} from "./dto/webshop-order-line-edit.dto.js";
import { WebshopOrderParcelCreateDto } from "./dto/webshop-order-parcel-create.dto.js";
import { WebshopOrderLinesService } from "./webshop-order-lines.service.js";
import { WebshopOrderNotifyDto } from "./dto/webshop-order-notify.dto.js";
import {
  WebshopOrderAddressDto,
  WebshopOrderNoteDto,
  WebshopOrderNotesDto,
  WebshopOrderPointDto,
} from "./dto/webshop-order-edits.dto.js";
import { WebshopOrderEditsService } from "./webshop-order-edits.service.js";
import { WebshopStaleThresholdsDto } from "./dto/webshop-order-stale-thresholds.dto.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import { WebshopOrderInvoiceService } from "./webshop-order-invoice.service.js";
import { WebshopOrderParcelService } from "./webshop-order-parcel.service.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/** Webshop / Rendelések: az új webshop rendelései (nem a UNAS-é, az a `integrations/unas/orders`). */
@Controller("webshop-orders")
export class WebshopOrdersController {
  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly invoices: WebshopOrderInvoiceService,
    private readonly parcels: WebshopOrderParcelService,
    private readonly lines: WebshopOrderLinesService,
    private readonly payments: WebshopOrderPaymentService,
    private readonly edits: WebshopOrderEditsService,
  ) {}

  /** A számlázási vagy a szállítási cím (a név is) szerkesztése. */
  @Put(":id/address")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  updateAddress(
    @Param("id") id: string,
    @Body() body: WebshopOrderAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.updateAddress(id, body, user);
  }

  /** A belső megjegyzés (csak OS); üres szöveg törli. */
  @Put(":id/internal-note")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  saveInternalNote(
    @Param("id") id: string,
    @Body() body: WebshopOrderNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.saveInternalNote(id, body.text, user);
  }

  /** A rendelés módjához választható csomagpontok (commerce #494). */
  @Get(":id/pickup-points")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  pickupPoints(@Param("id") id: string, @Query("q") q = "") {
    return this.edits.pickupPoints(id, q);
  }

  /** A csomagpont cseréje (commerce #494). */
  @Put(":id/pickup-point")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  changePoint(
    @Param("id") id: string,
    @Body() body: WebshopOrderPointDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.changePoint(id, body.pointId, user);
  }

  /** A vevő és a szállító megjegyzése (commerce #493). */
  @Put(":id/notes")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  saveNotes(
    @Param("id") id: string,
    @Body() body: WebshopOrderNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.edits.saveNotes(id, body, user);
  }

  /** „Csúszik a szállítás”: a kártyás zárolás feloldása, levél a vevőnek. */
  @Post(":id/payment/release-hold")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  releaseHold(
    @Param("id") id: string,
    @Body() body: WebshopOrderNotifyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.releaseHold(id, body.notifyCustomer ?? true, user);
  }

  /** „Fizetési link küldése”: a rendelés mostani végösszegére. */
  @Post(":id/payment/link")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  sendPaymentLink(
    @Param("id") id: string,
    @Body() body: WebshopOrderNotifyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.sendPaymentLink(id, body.notifyCustomer ?? true, user);
  }

  /**
   * TÉTELMŰVELET (mennyiség, csere, törlés) a webshop szerkesztési útján, a
   * Kiszállítás előtt. A válasz a friss adatlap.
   */
  @Post(":id/lines/:itemId")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  editLine(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: WebshopOrderLineEditDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.edit(id, itemId, lineEditOf(body), user);
  }

  /** Termékváltozatok a tétel cseréjéhez (név vagy cikkszám). */
  @Get(":id/replacement-variants")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  replacementVariants(@Query("q") query = "") {
    return this.lines.variants(query);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Query() query: WebshopOrderListQueryDto) {
    return this.orders.list(query);
  }

  /** Az elavulási küszöbök státuszonként (Beállítások; a lista is ezekkel jelez). */
  @Get("settings/stale-thresholds")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  staleThresholds() {
    return this.orders.staleThresholds();
  }

  /** A küszöbök mentése; ugyanaz a jog, ami a rendelést kezeli. */
  @Put("settings/stale-thresholds")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  saveStaleThresholds(
    @Body() body: WebshopStaleThresholdsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.saveStaleThresholds(body.thresholds, user.id);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  detail(@Param("id") id: string) {
    return this.orders.detail(id);
  }

  /** Státuszváltás a webshopban; a válasz a friss adatlap. */
  @Post(":id/status")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  changeStatus(
    @Param("id") id: string,
    @Body() body: WebshopOrderStatusChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.changeStatus(
      id,
      body.status,
      user.id,
      body.notifyCustomer ?? true,
    );
  }

  /** A legutóbbi státuszlevél újraküldése; a válasz a friss adatlap és a levél sorsa. */
  @Post(":id/status-mail/resend")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  resendStatusMail(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.resendStatusMail(id, user.id);
  }

  /**
   * A RENDELÉS SZÁMLÁJA: vázlat a rendelésből, és kiállítás. Mindkét jog
   * kell: a rendelés kezelése és a számla kiállítása (ugyanaz, ami a
   * Számlázás kiállítás-gombja mögött áll). A válasz a friss adatlap.
   */
  @Post(":id/invoice")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.BILLING_ISSUE)
  issueInvoice(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.issue(id, user);
  }

  /**
   * A RENDELÉS SZÁLLÍTÓLEVELE a kiállított számla tételeiből, ugyanazzal a
   * kiállítással (kártya 0a14f739 C/1). Ugyanaz a két jog kell, mint a
   * számlához. A válasz a friss adatlap.
   */
  @Post(":id/delivery-note")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.BILLING_ISSUE)
  issueDeliveryNote(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.issueDeliveryNote(id, user);
  }

  /**
   * CSOMAGFELADÁS: a szállítónál létrejön a csomag (a számla után), és a
   * webshop elküldi a „Feladtuk” levelet. A válasz a friss adatlap és a levél
   * sorsa.
   */
  @Post(":id/parcel")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  createParcel(
    @Param("id") id: string,
    @Body() body: WebshopOrderParcelCreateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcels.create(id, body.size, user);
  }

  /** A címke: a meglévő csomagé, újranyomtatáshoz is. */
  @Get(":id/parcel/label")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  @Header("Cache-Control", "private, no-store")
  async parcelLabel(@Param("id") id: string) {
    const bytes = await this.parcels.label(id);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(`cimke-${id}.pdf`)}`,
    });
  }

  /** A csomag állapota a szállítónál (csak olvasás). */
  @Get(":id/parcel/tracking")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  parcelTracking(@Param("id") id: string) {
    return this.parcels.tracking(id);
  }

  /** A bizonytalan foglalás feloldása, miután a szállító felületén megnézték. */
  @Post(":id/parcel/release")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  releaseParcel(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parcels.release(id, user);
  }
}
