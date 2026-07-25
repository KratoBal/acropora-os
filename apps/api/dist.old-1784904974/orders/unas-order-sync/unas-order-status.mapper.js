export function mapUnasOrderStatus(statusType) {
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
//# sourceMappingURL=unas-order-status.mapper.js.map