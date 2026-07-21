export type LocalOrderStatus =
  | "DRAFT"
  | "PENDING"
  | "CONFIRMED"
  | "PICKING"
  | "PACKED"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED"
  | "ON_HOLD";

/// UNAS's own order statuses are shop-configurable free text; the only
/// stable, documented classification is the 4-value StatusType. This maps
/// that coarse classification onto our SalesOrderStatus enum. open_prepare
/// ("feldolgozáson kívüli") maps to ON_HOLD rather than CONFIRMED because it
/// specifically means the order is outside normal processing.
export function mapUnasOrderStatus(
  statusType: string | null,
): LocalOrderStatus {
  switch (statusType) {
    case "close_ok":
      return "COMPLETED";
    case "close_fault":
      return "CANCELLED";
    case "open_prepare":
      return "ON_HOLD";
    case "open_normal":
    default:
      return "CONFIRMED";
  }
}
