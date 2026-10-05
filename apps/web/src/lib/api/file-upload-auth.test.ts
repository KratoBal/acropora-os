import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importApi } from "./imports";
import { inventoryApi } from "./inventory";
import { uploadMessageAttachment } from "./messages";

const originalXmlHttpRequest = globalThis.XMLHttpRequest;

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

class FakeXmlHttpRequest {
  static instances: FakeXmlHttpRequest[] = [];

  readonly headers: Record<string, string> = {};
  readonly upload = {
    addEventListener: vi.fn(),
  };
  readonly open = vi.fn();
  readonly send = vi.fn(() => {
    queueMicrotask(() => this.dispatch("load"));
  });
  status = 200;
  responseText = "{}";

  private readonly listeners = new Map<
    string,
    EventListenerOrEventListenerObject
  >();

  constructor() {
    FakeXmlHttpRequest.instances.push(this);
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) {
    if (listener) this.listeners.set(type, listener);
  }

  private dispatch(type: string) {
    const listener = this.listeners.get(type);
    if (typeof listener === "function") {
      listener(new Event(type));
    } else {
      listener?.handleEvent(new Event(type));
    }
  }
}

beforeEach(() => {
  clearCookies();
  FakeXmlHttpRequest.instances = [];
  globalThis.XMLHttpRequest =
    FakeXmlHttpRequest as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXmlHttpRequest;
  clearCookies();
  vi.restoreAllMocks();
});

describe("file upload authentication", () => {
  it("sends the CSRF cookie with a production inventory XLSX upload", async () => {
    document.cookie = "acropora_csrf=inventory-csrf";

    const upload = inventoryApi.uploadCounts(
      "",
      "count-1",
      new File(["xlsx"], "inventory.xlsx"),
    );
    const request = FakeXmlHttpRequest.instances[0];

    expect(request?.open).toHaveBeenCalledWith(
      "POST",
      "/api/inventory/counts/count-1/upload",
    );
    expect(request?.headers).toMatchObject({
      Accept: "application/json",
      "X-CSRF-Token": "inventory-csrf",
    });
    expect(request?.headers).not.toHaveProperty("Authorization");
    await expect(upload).resolves.toEqual({});
  });

  it("sends the CSRF cookie with a production UNAS XLSX import", async () => {
    document.cookie = "acropora_csrf=unas-csrf";

    const upload = importApi.uploadDryRun(
      "",
      new File(["xlsx"], "catalog.xlsx"),
      vi.fn(),
    );
    const request = FakeXmlHttpRequest.instances[0];

    expect(request?.open).toHaveBeenCalledWith(
      "POST",
      "/api/imports/unas/catalog/dry-run",
    );
    expect(request?.headers).toMatchObject({
      Accept: "application/json",
      "X-CSRF-Token": "unas-csrf",
    });
    expect(request?.headers).not.toHaveProperty("Authorization");
    await expect(upload).resolves.toEqual({});
  });

  it("keeps Bearer authentication for a development inventory upload", async () => {
    const upload = inventoryApi.uploadCounts(
      "dev-token",
      "count-1",
      new File(["xlsx"], "inventory.xlsx"),
    );
    const request = FakeXmlHttpRequest.instances[0];

    expect(request?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer dev-token",
    });
    expect(request?.headers).not.toHaveProperty("X-CSRF-Token");
    await expect(upload).resolves.toEqual({});
  });
  it("a message attachment upload carries the CSRF cookie, and an unreadable success is an error", async () => {
    document.cookie = "acropora_csrf=messages-csrf";
    const progress = vi.fn();

    const ok = uploadMessageAttachment(
      "",
      "c1",
      new File(["jpg"], "kep.jpg", { type: "image/jpeg" }),
      progress,
    );
    const first = FakeXmlHttpRequest.instances[0];
    first!.responseText = '{"id":"att-1"}';
    expect(first?.open).toHaveBeenCalledWith(
      "POST",
      "/api/messages/conversations/c1/attachments",
    );
    expect(first?.headers).toMatchObject({ "X-CSRF-Token": "messages-csrf" });
    await expect(ok).resolves.toEqual({ id: "att-1" });
    expect(progress).toHaveBeenLastCalledWith(100);

    const empty = uploadMessageAttachment(
      "",
      "c1",
      new File(["jpg"], "kep.jpg", { type: "image/jpeg" }),
      progress,
    );
    FakeXmlHttpRequest.instances[1]!.responseText = "";
    await expect(empty).rejects.toThrow("A szerver válasza nem olvasható.");
  });
  it("an inventory upload whose success body is unreadable is an error, not an empty result", async () => {
    const upload = inventoryApi.uploadCounts(
      "",
      "count-1",
      new File(["xlsx"], "inventory.xlsx"),
    );
    FakeXmlHttpRequest.instances[0]!.responseText = "";
    await expect(upload).rejects.toThrow("A szerver válasza nem olvasható.");
  });
});
