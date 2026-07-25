import { randomUUID } from "node:crypto";
export function generateCode(prefix) {
    const now = new Date();
    const stamp = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace("T", "-")
        .slice(0, 15);
    return `${prefix}-${stamp}-${randomUUID().slice(0, 4).toUpperCase()}`;
}
//# sourceMappingURL=code-generator.util.js.map