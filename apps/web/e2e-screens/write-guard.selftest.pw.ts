import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

import { blockedCell, blockWrites } from "./write-guard";

/*
  AZ ÍRÁS-SZŰRŐ ÖNTESZTJE (barracuda, #2091): egy helyi szerver, aminek a lapja betöltéskor ír (fetch POST, XHR PUT,
  sendBeacon, és egy magától elküldött űrlap). MI PIROSÍT: ha a szűrővel egy írás eléri a szervert; ha a szűrő nem
  jegyzi fel a megszakított kérést; és a POZITÍV KONTROLL, ha szűrő NÉLKÜL nem ér el írás a szervert (akkor a lap nem
  ír, és a szűrős nulla semmit nem bizonyít). A három szélesség-projekt és a belépés ettől a projekttől függ: hibás szűrővel
  egyetlen éles lap sem nyílik meg. Futtatható magában, stage nélkül: `pnpm ui:screens --project onteszt`.
*/
const PAGE = `<!doctype html><html><body><script>
  const done = [];
  done.push(fetch("/w/fetch", { method: "POST", body: "x" }).catch(() => undefined));
  done.push(new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/w/xhr");
    xhr.onloadend = resolve;
    xhr.send("x");
  }));
  navigator.sendBeacon("/w/beacon", "x");
  Promise.all(done).then(() => { window.__done = true; });
</script></body></html>`;
const FORM = `<!doctype html><html><body><form method="post" action="/w/form"><input name="a" value="1"></form>
  <script>document.forms[0].submit();</script></body></html>`;

let server: Server;
let base = "";
const writes: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD")
      writes.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/form" ? FORM : req.url === "/" ? PAGE : "ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  writes.length = 0;
});

/** A lap a fetch, az XHR és a beacon elküldése után; a beacon a lap mögött mehet ki, ezért rövid utánvárás. */
async function loadWriter(page: import("@playwright/test").Page) {
  await page.goto(`${base}/`);
  await page.waitForFunction(() => (window as { __done?: boolean }).__done);
  await page.goto(`${base}/form`).catch(() => undefined);
  await page.waitForTimeout(500);
}

test("POZITÍV KONTROLL: szűrő nélkül a lap írása eléri a szervert", async ({
  page,
}) => {
  await loadWriter(page);
  expect(writes).toEqual(
    expect.arrayContaining([
      "POST /w/fetch",
      "PUT /w/xhr",
      "POST /w/beacon",
      "POST /w/form",
    ]),
  );
});

test("a szűrővel egy írás sem éri el a szervert, és mind feljegyződik", async ({
  context,
  page,
}) => {
  const blocked = await blockWrites(context);
  await loadWriter(page);
  expect(writes).toEqual([]);
  expect(blocked.map((b) => `${b.method} ${new URL(b.url).pathname}`)).toEqual(
    expect.arrayContaining([
      "POST /w/fetch",
      "PUT /w/xhr",
      "POST /w/beacon",
      "POST /w/form",
    ]),
  );
  expect(blockedCell(blocked)).toContain("POST 127.0.0.1:");
  expect(blockedCell([])).toBe("-");
});
