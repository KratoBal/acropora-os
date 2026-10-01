import { DASHBOARD_WIDGETS } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { DASHBOARD_WIDGET_VIEWS } from "./index";

describe("a widget-regiszter React oldala", () => {
  it("minden aktív widgetnek van kártyája, és nem aktívnak nincs", () => {
    for (const widget of DASHBOARD_WIDGETS) {
      const hasView = DASHBOARD_WIDGET_VIEWS[widget.id] !== undefined;
      expect([widget.id, hasView]).toEqual([
        widget.id,
        widget.availability === "active",
      ]);
    }
  });
});
