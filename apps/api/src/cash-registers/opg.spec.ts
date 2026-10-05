import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import PizZip from "pizzip";
import { Prisma } from "@acropora/database";
import { cmsPayload, archivePayload } from "./opg-archive.js";
import { OpgClient, opgEnvelope, type OpgFile } from "./opg-client.js";
import { parseReceipts, netAmount, businessDay } from "./opg-receipts.js";
import { parseOpgXml, OpgError, OPG_LOG_NS } from "./opg-xml.js";
import type { ResolvedNavCredentials } from "../integrations/nav/nav-credentials.service.js";
import { CashRegisterService } from "./cash-register.service.js";
import type { CashRegisterRepository } from "./cash-register.repository.js";
import type { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { opgScheduleConfig } from "./cash-register.scheduler.js";
import { parseArgs } from "./cash-register-backfill.cli.js";
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../src/cash-registers/fixtures/${name}`, import.meta.url),
  );
const xml = fixture("A01413081-11575.xml");
const credentials: ResolvedNavCredentials = {
  technicalUser: {
    login: "dummy",
    password: "dummy",
    taxNumber: "12345678",
    signKey: "dummy",
  },
  software: {
    softwareId: "DUMMY0000000000001",
    softwareName: "Test",
    softwareOperation: "ONLINE_SERVICE",
    softwareMainVersion: "1.0",
    softwareDevName: "Test",
    softwareDevContact: "test@example.test",
    softwareDevCountryCode: "HU",
    softwareDevTaxNumber: "12345678",
  },
  revision: "test",
};
const tlv = (tag: number, data: Buffer) =>
  Buffer.concat([
    Buffer.from([tag, 0x84]),
    Buffer.from([
      (data.length >>> 24) & 255,
      (data.length >>> 16) & 255,
      (data.length >>> 8) & 255,
      data.length & 255,
    ]),
    data,
  ]);
const seq = (...values: Buffer[]) => tlv(48, Buffer.concat(values));
const oid = (hex: string) => tlv(6, Buffer.from(hex, "hex"));
export const cms = (payload: Buffer, constructed = false) =>
  seq(
    oid("2a864886f70d010702"),
    tlv(
      160,
      seq(
        tlv(2, Buffer.from([1])),
        tlv(49, Buffer.alloc(0)),
        seq(
          oid("2a864886f70d010701"),
          tlv(
            160,
            constructed
              ? Buffer.concat([
                  Buffer.from([36, 128]),
                  tlv(4, payload.subarray(0, 90)),
                  tlv(4, payload.subarray(90)),
                  Buffer.from([0, 0]),
                ])
              : tlv(4, payload),
          ),
        ),
        tlv(49, Buffer.alloc(0)),
      ),
    ),
  );
const archive = (payload: Buffer) =>
  new PizZip()
    .file("receipt.p7b", cms(payload, true))
    .generate({ type: "nodebuffer", compression: "DEFLATE" });
test("real receipt fixture: seven receipts, flat item groups, exact payment totals and Budapest day", () => {
  const receipts = parseReceipts(xml, "A01413081", 11575);
  assert.equal(receipts.length, 7);
  assert.equal(receipts[0]!.lines.length, 2);
  assert.equal(receipts[1]!.lines.length, 5);
  assert.equal(receipts[0]!.issuedAt.toISOString(), "2026-10-03T08:32:46.000Z");
  assert.equal(
    receipts[0]!.businessDay.toISOString(),
    "2026-10-03T00:00:00.000Z",
  );
  const sum = receipts.reduce((s, r) => s.add(r.total), new Prisma.Decimal(0));
  assert.equal(sum.toString(), "469890");
  const payments = receipts.flatMap((r) => r.payments);
  assert.equal(
    payments
      .filter((p) => p.category === "CARD")
      .reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0))
      .toString(),
    "458090",
  );
  assert.equal(
    payments
      .filter((p) => p.category === "CASH")
      .reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0))
      .toString(),
    "11800",
  );
  assert.ok(receipts.every((r) => r.lines.every((l) => l.name === "GYŰJTŐ 1")));
  assert.ok(
    !/\d/.test(
      [...xml.toString().matchAll(/<CCN>(.*?)<\/CCN>/gs)]
        .map((m) => m[1])
        .join(""),
    ),
  );
});
test("storno/return signs, mixed payments, cancelled and training documents", () => {
  const row = (name: string, key: string, value: string, extra = "") =>
    `<${name}><${key}>1/${name}</${key}><DTS>2026-10-03T23:30:00Z</DTS><SUM>${value}</SUM><CNC>0</CNC>${extra}</${name}>`;
  const receipts = parseReceipts(
    Buffer.from(
      `<ROWS xmlns="${OPG_LOG_NS}"><LON><APN>A01413081</APN><LFN>1</LFN></LON>${row("SZN", "SBS", "100", "<DRC><FE1>40</FE1><FE2>60</FE2></DRC>")}${row("VBN", "VBS", "-15,50")}${row("NYN", "NSZ", "9").replace("<CNC>0", "<CNC>1")}${row("NYT", "NSZ", "999")}${row("NFN", "NSZ", "999")}</ROWS>`,
    ),
    "A01413081",
    1,
  );
  assert.equal(receipts.length, 3);
  assert.equal(
    netAmount(receipts[0]!.kind, receipts[0]!.total).toString(),
    "-100",
  );
  assert.deepEqual(receipts[0]!.payments, [
    { category: "CASH", amount: "-40" },
    { category: "CARD", amount: "-60" },
  ]);
  assert.equal(
    netAmount(receipts[1]!.kind, receipts[1]!.total).toString(),
    "-15.5",
  );
  assert.ok(receipts[2]!.cancelled);
  assert.equal(businessDay(receipts[0]!.issuedAt), "2026-10-04");
});
test("wrong identity, duplicate receipts, missing fields, wrong namespaces and XML entities fail closed", () => {
  assert.throws(
    () => parseReceipts(xml, "A01413081", 1),
    /OPG_LOG_IDENTITY_MISMATCH/,
  );
  assert.throws(
    () =>
      parseReceipts(
        Buffer.from(
          xml.toString().replace("<SUM>2000</SUM>", "<SUM>NaN</SUM>"),
        ),
        "A01413081",
        11575,
      ),
    /OPG_AMOUNT_INVALID/,
  );
  assert.throws(
    () => parseOpgXml('<!DOCTYPE foo [<!ENTITY x "secret">]><foo>&x;</foo>'),
    /OPG_XML_INVALID/,
  );
  const duplicate = xml.toString().replace("2820/00002", "2820/00001");
  assert.throws(
    () => parseReceipts(Buffer.from(duplicate), "A01413081", 11575),
    /OPG_DUPLICATE_RECEIPT/,
  );
});
test("bounded CMS primitive and segmented BER extraction and ZIP CRC", () => {
  assert.deepEqual(cmsPayload(cms(xml)), xml);
  assert.deepEqual(cmsPayload(cms(xml, true)), xml);
  assert.deepEqual(archivePayload(archive(xml)), xml);
  assert.throws(
    () => cmsPayload(Buffer.concat([cms(xml), Buffer.from("<?xml evil?>")])),
    /OPG_CMS_INVALID/,
  );
  assert.throws(
    () =>
      archivePayload(
        new PizZip()
          .file("receipt.p7b", cms(xml))
          .file("unexpected.txt", "bad")
          .generate({ type: "nodebuffer" }),
      ),
    /OPG_ARCHIVE_INVALID/,
  );
});
test("correct endpoint, API software namespace, v1 and namespace-independent status", async () => {
  const transport: typeof fetch = async (url, init) => {
    assert.equal(
      url,
      "https://api-onlinepenztargep.nav.gov.hu/queryCashRegisterFile/v1/queryCashRegisterStatus",
    );
    assert.match(String(init?.body), /<com:requestVersion>1.0/);
    assert.match(String(init?.body), /<api:software>/);
    assert.doesNotMatch(String(init?.body), /<com:software>/);
    return new Response(
      fixture("status.xml")
        .toString()
        .replaceAll("ns3:", "different:")
        .replace("xmlns:ns3=", "xmlns:different="),
    );
  };
  assert.deepEqual(await new OpgClient(transport).status(credentials), [
    { apNumber: "A01413081", min: 11542, max: 11579 },
  ]);
  assert.match(
    opgEnvelope("Status", credentials, "<api:cashRegisterStatusQuery/>"),
    /<com:requestSignature cryptoType="SHA3-512">[0-9A-F]{128}</,
  );
});
test("MTOM binary ZIP, encoded cid and XOP namespace; exact file query", async () => {
  const soap = fixture("file-response.xml")
    .toString()
    .replace(
      "[MTOM attachment: ZIP containing the .p7b]",
      '<a:Include xmlns:a="http://www.w3.org/2004/08/xop/include" href="cid:file%40nav"/>',
    );
  const wire = Buffer.concat([
    Buffer.from(
      `--nav-boundary\r\nContent-Type: application/xop+xml\r\n\r\n${soap}\r\n--nav-boundary\r\nContent-Type: application/octet-stream\r\nContent-ID: <file@nav>\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
    ),
    archive(xml),
    Buffer.from("\r\n--nav-boundary--\r\n"),
  ]);
  const transport: typeof fetch = async (url, init) => {
    assert.ok(String(url).endsWith("/queryCashRegisterFile"));
    assert.match(String(init?.body), /<api:fileNumberStart>11575/);
    assert.match(String(init?.body), /<api:fileNumberEnd>11575/);
    return new Response(wire, {
      headers: { "content-type": 'multipart/related; boundary="nav-boundary"' },
    });
  };
  const page = await new OpgClient(transport).files(
    credentials,
    "A01413081",
    11575,
    11575,
  );
  assert.equal(page.files[0]!.number, 11575);
  assert.deepEqual(page.files[0]!.xml, xml);
});
function harness(
  pages: Array<{
    files: OpgFile[];
    allFilesSent: boolean;
    reason?: string;
    min: number;
    max: number;
  }>,
  next = 1,
  max = 3,
) {
  const saved: number[] = [],
    queries: number[][] = [],
    ends: unknown[] = [];
  const repository = {
    startRun: async () => ({ id: "run" }),
    heartbeat: async () => {},
    prepare: async () => ({ next, gap: next === 2 ? 1 : 0 }),
    existing: async () => new Set(),
    save: async (f: OpgFile) => {
      saved.push(f.number);
      return 1;
    },
    finish: async (...a: unknown[]) => {
      ends.push(a);
    },
  };
  const client = {
    status: async () => [{ apNumber: "A01413081", min: 1, max }],
    files: async (_c: unknown, _a: string, start: number, end: number) => {
      queries.push([start, end]);
      const page = pages.shift();
      if (!page) throw new OpgError("OPG_TEST_NO_PAGE");
      return page;
    },
  };
  const service = new CashRegisterService(
    client as unknown as OpgClient,
    { resolve: async () => credentials } as NavCredentialsService,
    repository as unknown as CashRegisterRepository,
  );
  return { service, saved, queries, ends };
}
const file = (number: number): OpgFile => ({
  apNumber: "A01413081",
  number,
  name: `file${number}`,
  validation: "OK",
  xml,
});
test("SIZE continues from exact next number and never jumps to server max", async () => {
  const h = harness([
    { files: [file(1)], allFilesSent: false, reason: "SIZE", min: 1, max: 3 },
    { files: [file(2), file(3)], allFilesSent: true, min: 1, max: 3 },
  ]);
  assert.deepEqual(await h.service.sync(), {
    filesFetched: 3,
    receiptsCreated: 3,
    gapsRecorded: 0,
  });
  assert.deepEqual(h.queries, [
    [1, 3],
    [2, 3],
  ]);
  assert.deepEqual(h.saved, [1, 2, 3]);
});
test("a hole, silent short page and NOT_AVAILABLE within retention fail without skipping", async () => {
  for (const page of [
    { files: [file(1), file(3)], allFilesSent: true, min: 1, max: 3 },
    { files: [file(1)], allFilesSent: true, min: 1, max: 3 },
    { files: [], allFilesSent: false, reason: "NOT_AVAILABLE", min: 1, max: 3 },
  ]) {
    const h = harness([page]);
    await assert.rejects(h.service.sync(), /OPG_FILE_GAP/);
    assert.deepEqual(h.saved, []);
    assert.match(JSON.stringify(h.ends), /OPG_FILE_GAP/);
  }
});
test("expired gap count remains visible and dry run, CLI and schedule are opt in", async () => {
  const h = harness(
    [{ files: [file(2), file(3)], allFilesSent: true, min: 2, max: 3 }],
    2,
  );
  assert.equal((await h.service.sync()).gapsRecorded, 1);
  assert.equal(opgScheduleConfig({}).enabled, false);
  assert.equal(
    opgScheduleConfig({ NAV_CASH_REGISTER_SYNC_ENABLED: "true" }).intervalMs,
    86400000,
  );
  assert.throws(() =>
    opgScheduleConfig({
      NAV_CASH_REGISTER_SYNC_ENABLED: "true",
      NAV_CASH_REGISTER_SYNC_INTERVAL_MINUTES: "0",
    }),
  );
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--", "--apply"]), { apply: true });
  assert.throws(() => parseArgs(["--production"]));
});
