import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clientKey,
  GamePublicController,
  lastHopAddress,
} from "./game-public.controller.js";

/*
  THE PUBLIC ENDPOINTS' LIMITS (barracuda on #2254; acrobot 43965). What turns this red: the limit keyed on a hop the
  caller writes (a forged first hop would buy a fresh allowance); the page's vouched visitor address taken without
  the shared secret, with a wrong one, or in a shape that is no address; and, with the secret, the visitors behind the
  page's one server sharing one allowance (the 61st page load of a campaign minute answered 429).
*/
const SECRET = "teszt-titok-0123456789";
const viaPage = (ip: string, secret = SECRET) => ({
  headers: {
    "x-forwarded-for": `${ip}, 10.0.0.7`,
    "x-jatek-client-ip": ip,
    "x-jatek-proxy-secret": secret,
  },
  ip: "10.0.0.7",
});

describe("the key of the public limits", () => {
  it("the last hop, which the caller cannot write, when nothing vouches", () => {
    assert.equal(
      lastHopAddress({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }),
      "5.6.7.8",
    );
    assert.equal(lastHopAddress({ headers: {}, ip: "9.9.9.9" }), "9.9.9.9");
  });

  it("the visitor the page vouches for, only with the right secret and an address-shaped value", () => {
    assert.equal(
      clientKey(viaPage("198.51.100.4"), SECRET),
      "jatek:198.51.100.4",
    );
    assert.equal(
      clientKey(viaPage("198.51.100.4", "rossz"), SECRET),
      "10.0.0.7",
    );
    assert.equal(clientKey(viaPage("198.51.100.4"), undefined), "10.0.0.7");
    assert.equal(clientKey(viaPage("nem cim; drop"), SECRET), "10.0.0.7");
  });

  it("with the secret, a campaign minute's visitors behind the page's one address are not one allowance", async () => {
    const before = process.env.JATEK_PROXY_SECRET;
    process.env.JATEK_PROXY_SECRET = SECRET;
    try {
      const game = {
        current: async () => ({ question: null }),
        confirm: async () => ({ status: "CONFIRMED", week: "2026-W45" }),
      };
      const controller = new GamePublicController(game as never);
      for (let i = 0; i < 200; i++)
        await controller.current(viaPage(`198.51.100.${i}`) as never);
      for (let i = 0; i < 100; i++)
        await controller.confirm(
          { token: "x" } as never,
          viaPage(`203.0.113.${i}`) as never,
        );
    } finally {
      if (before === undefined) delete process.env.JATEK_PROXY_SECRET;
      else process.env.JATEK_PROXY_SECRET = before;
    }
  });
});
