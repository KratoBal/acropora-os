import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { PDF_PAGES, pdfOf } from "./extraction-test-fixtures.js";
import {
  MAX_PDF_BYTES,
  MAX_PDF_REDIRECTS,
  MAX_ROBOTS_REDIRECTS,
  NOT_PUBLIC_ADDRESS,
  fetchOpenPdf,
  guardedFetch,
  pdfSections,
  publicAddress,
  publicHttpUrl,
  type HostLookup,
  type PdfFetch,
} from "./pdf-full-text.js";

/*
  THE OPEN PDF (research-kepes-kiolvasas, first slice). What turns this red:
  a local or address-literal URL fetched, a redirect to one followed, a path
  the robots.txt disallows fetched, an unreadable robots.txt taken as
  permission, a landing page taken as a PDF, the references list read.
*/

type Answer = {
  status: number;
  body?: BodyInit;
  headers?: Record<string, string>;
};

function network(table: Record<string, Answer>) {
  const asked: string[] = [];
  const fetch: PdfFetch = async (url, init) => {
    asked.push(url);
    assert.equal(init.redirect, "manual");
    const a = table[url] ?? { status: 404 };
    return new Response(a.body ?? null, {
      status: a.status,
      headers: a.headers,
    });
  };
  return { fetch, asked };
}

describe("a public http(s) URL", () => {
  it("accepts a publisher's https or http link, refuses the rest", () => {
    for (const ok of [
      "https://kiado.example.org/cikk.pdf",
      "http://kiado.example.org:80/cikk.pdf",
    ])
      assert.ok(publicHttpUrl(ok), ok);
    for (const bad of [
      "ftp://kiado.example.org/a.pdf",
      "https://127.0.0.1/a.pdf",
      "https://[::1]/a.pdf",
      "https://localhost/a.pdf",
      "https://db.internal/a.pdf",
      "https://kiado.example.org:8080/a.pdf",
      "https://user:pw@kiado.example.org/a.pdf",
      "nem url",
    ])
      assert.equal(publicHttpUrl(bad), null, bad);
  });
});

describe("fetching the open PDF", () => {
  const PDF = "https://kiado.example.org/cikk.pdf";
  const ROBOTS = "https://kiado.example.org/robots.txt";

  it("reads the robots.txt, then the PDF, and hashes its bytes", async () => {
    const bytes = await pdfOf(PDF_PAGES);
    const n = network({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 200, body: bytes },
    });
    const answer = await fetchOpenPdf(PDF, n.fetch);
    assert.ok(answer.ok);
    assert.equal(answer.contentHash.length, 64);
    assert.deepEqual(n.asked, [ROBOTS, PDF]);
  });

  it("a disallowed path or an unreadable robots.txt: no PDF request", async () => {
    const disallowed = network({
      [ROBOTS]: { status: 200, body: "User-agent: *\nDisallow: /cikk" },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, disallowed.fetch), {
      ok: false,
      reason: "ROBOTS_DISALLOWED",
    });
    assert.deepEqual(disallowed.asked, [ROBOTS]);
    const down = network({ [ROBOTS]: { status: 503 } });
    assert.deepEqual(await fetchOpenPdf(PDF, down.fetch), {
      ok: false,
      reason: "ROBOTS_UNREADABLE",
    });
    assert.deepEqual(down.asked, [ROBOTS]);
  });

  it("a robots.txt that redirects is followed, and the last answer counts (RFC 9309; doi.org, hal.science)", async () => {
    const bytes = await pdfOf(PDF_PAGES);
    // hal.science's shape: 302 to a path on the same host
    const moved = network({
      [ROBOTS]: { status: 302, headers: { location: "/robots" } },
      "https://kiado.example.org/robots": {
        status: 200,
        body: "User-agent: *\nAllow: /",
      },
      [PDF]: { status: 200, body: bytes },
    });
    assert.ok((await fetchOpenPdf(PDF, moved.fetch)).ok);
    // doi.org's shape: 301 to another host, whose rule disallows the path
    const elsewhere = network({
      [ROBOTS]: {
        status: 301,
        headers: { location: "https://www.kiado.example.org/robots.txt" },
      },
      "https://www.kiado.example.org/robots.txt": {
        status: 200,
        body: "User-agent: *\nDisallow: /cikk",
      },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, elsewhere.fetch), {
      ok: false,
      reason: "ROBOTS_DISALLOWED",
    });
    assert.equal(elsewhere.asked.includes(PDF), false);
  });

  it("a robots.txt redirect past five, or to a non-public URL, is unreadable; a 403 stays a refusal", async () => {
    const chain: Record<string, Answer> = {};
    for (let i = 0; i <= MAX_ROBOTS_REDIRECTS; i += 1)
      chain[i === 0 ? ROBOTS : `https://kiado.example.org/r${i}`] = {
        status: 302,
        headers: { location: `https://kiado.example.org/r${i + 1}` },
      };
    assert.deepEqual(await fetchOpenPdf(PDF, network(chain).fetch), {
      ok: false,
      reason: "ROBOTS_UNREADABLE",
    });
    const inward = network({
      [ROBOTS]: {
        status: 302,
        headers: { location: "http://10.0.0.5/robots.txt" },
      },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, inward.fetch), {
      ok: false,
      reason: "ROBOTS_UNREADABLE",
    });
    assert.deepEqual(inward.asked, [ROBOTS]);
    const closed = network({ [ROBOTS]: { status: 403 } });
    assert.deepEqual(await fetchOpenPdf(PDF, closed.fetch), {
      ok: false,
      reason: "ROBOTS_DISALLOWED",
    });
  });

  it("follows a public redirect, not one to a local address, and not too many", async () => {
    const bytes = await pdfOf(PDF_PAGES);
    const moved = network({
      [ROBOTS]: { status: 404 },
      [PDF]: {
        status: 302,
        headers: { location: "https://cdn.example.org/x.pdf" },
      },
      "https://cdn.example.org/robots.txt": { status: 404 },
      "https://cdn.example.org/x.pdf": { status: 200, body: bytes },
    });
    assert.ok((await fetchOpenPdf(PDF, moved.fetch)).ok);

    const inward = network({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 302, headers: { location: "http://10.0.0.5/admin" } },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, inward.fetch), {
      ok: false,
      reason: "NOT_PUBLIC_URL",
    });
    assert.equal(inward.asked.length, 2);

    const loop: Record<string, Answer> = { [ROBOTS]: { status: 404 } };
    for (let i = 0; i <= MAX_PDF_REDIRECTS + 1; i += 1)
      loop[i === 0 ? PDF : `https://kiado.example.org/r${i}.pdf`] = {
        status: 302,
        headers: { location: `https://kiado.example.org/r${i + 1}.pdf` },
      };
    assert.deepEqual(await fetchOpenPdf(PDF, network(loop).fetch), {
      ok: false,
      reason: "TOO_MANY_REDIRECTS",
    });
  });

  it("the address guard's refusal is NOT_PUBLIC_ADDRESS, on the robots.txt and on the PDF alike", async () => {
    const refuse: PdfFetch = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: NOT_PUBLIC_ADDRESS },
      });
    };
    assert.deepEqual(await fetchOpenPdf(PDF, refuse), {
      ok: false,
      reason: NOT_PUBLIC_ADDRESS,
    });
    // a redirect to a name that resolves privately: refused at its robots.txt
    const n = network({
      [ROBOTS]: { status: 404 },
      [PDF]: {
        status: 302,
        headers: { location: "https://belso.example.org/x.pdf" },
      },
    });
    const guarded: PdfFetch = async (url, init) => {
      if (url.startsWith("https://belso.example.org/"))
        throw Object.assign(new Error("guard"), { code: NOT_PUBLIC_ADDRESS });
      return n.fetch(url, init);
    };
    assert.deepEqual(await fetchOpenPdf(PDF, guarded), {
      ok: false,
      reason: NOT_PUBLIC_ADDRESS,
    });
  });

  it("a body past the cap without a content-length: TOO_LARGE, and the read stops there (barracuda, #1951)", async () => {
    const chunk = new Uint8Array(1_000_000).fill(37);
    let pulls = 0;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
      });
    const n = network({ [ROBOTS]: { status: 404 } });
    const big: PdfFetch = async (url, init) =>
      url === PDF
        ? new Response(endless(), { status: 200 })
        : n.fetch(url, init);
    assert.deepEqual(await fetchOpenPdf(PDF, big), {
      ok: false,
      reason: "TOO_LARGE",
    });
    assert.ok(pulls <= MAX_PDF_BYTES / chunk.byteLength + 3, String(pulls));
    // the robots.txt under its own cap, 512 KB
    pulls = 0;
    const bigRobots: PdfFetch = async (url) =>
      new Response(endless(), { status: url === ROBOTS ? 200 : 404 });
    assert.deepEqual(await fetchOpenPdf(PDF, bigRobots), {
      ok: false,
      reason: "ROBOTS_UNREADABLE",
    });
    assert.ok(pulls <= 3, String(pulls));
  });

  it("a landing page that names its PDF (citation_pdf_url) is followed to it, once, through the same checks", async () => {
    const bytes = await pdfOf(PDF_PAGES);
    const landing = (meta: string) =>
      `<html><head><meta name="citation_title" content="x"><meta content="${meta}" name="citation_pdf_url"></head></html>`;
    // HAL's shape: a relative /document path on the same host, with &amp;
    const hal = network({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 200, body: landing("/hal-01/document?a=1&amp;b=2") },
      "https://kiado.example.org/hal-01/document?a=1&b=2": {
        status: 200,
        body: bytes,
      },
    });
    assert.ok((await fetchOpenPdf(PDF, hal.fetch)).ok);
    // another host: its own robots.txt first
    const other = network({
      [ROBOTS]: { status: 404 },
      [PDF]: {
        status: 200,
        body: landing("https://journal.example.org/download/12/pdf"),
      },
      "https://journal.example.org/robots.txt": {
        status: 200,
        body: "User-agent: *\nDisallow: /download",
      },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, other.fetch), {
      ok: false,
      reason: "ROBOTS_DISALLOWED",
    });
    // a landing page that names another landing page: followed once only
    const loop = network({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 200, body: landing("/masik") },
      "https://kiado.example.org/masik": {
        status: 200,
        body: landing("/harmadik"),
      },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, loop.fetch), {
      ok: false,
      reason: "NOT_PDF",
    });
    assert.equal(
      loop.asked.includes("https://kiado.example.org/harmadik"),
      false,
    );
    // a named PDF on a non-public URL is not fetched
    const inward = network({
      [ROBOTS]: { status: 404 },
      [PDF]: { status: 200, body: landing("http://10.0.0.5/x.pdf") },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, inward.fetch), {
      ok: false,
      reason: "NOT_PUBLIC_URL",
    });
  });

  it("a landing page with a PDF header is not a PDF", async () => {
    const n = network({
      [ROBOTS]: { status: 404 },
      [PDF]: {
        status: 200,
        body: "<html>Log in to read</html>",
        headers: { "content-type": "application/pdf" },
      },
    });
    assert.deepEqual(await fetchOpenPdf(PDF, n.fetch), {
      ok: false,
      reason: "NOT_PDF",
    });
  });
});

describe("the address guard, at connect time (a local server, a name resolved by the test)", () => {
  let port = 0;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.end("%PDF-1.4 kitalalt");
  });
  before(
    () =>
      new Promise<void>((done) =>
        server.listen(0, "127.0.0.1", () => {
          port = (server.address() as AddressInfo).port;
          done();
        }),
      ),
  );
  after(() => new Promise<void>((done) => server.close(() => done())));

  const to =
    (address: string): HostLookup =>
    async () => [{ address, family: address.includes(":") ? 6 : 4 }];
  const get = (fetch: PdfFetch) =>
    fetch(`http://kiado.example.org:${port}/x.pdf`, {
      method: "GET",
      headers: {},
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });

  it("a public name resolving to loopback or the tailnet range: refused before the connection opens", async () => {
    for (const address of ["127.0.0.1", "100.64.1.2", "::ffff:127.0.0.1"]) {
      await assert.rejects(
        get(guardedFetch({ resolve: to(address) })),
        (e: { code?: string }) => e.code === NOT_PUBLIC_ADDRESS,
        address,
      );
    }
    assert.equal(requests, 0);
  });

  it("the same request with the guard let through reaches the server: the refusal is the guard's", async () => {
    const response = await get(
      guardedFetch({ resolve: to("127.0.0.1"), isPublic: () => true }),
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "%PDF-1.4 kitalalt");
    assert.equal(requests, 1);
  });
});

describe("a public address", () => {
  it("refuses loopback, link-local, RFC 1918, CGNAT, multicast, ULA, site-local, and private IPv4 inside IPv6 in every form", () => {
    for (const ok of [
      "93.184.216.34",
      "100.63.255.255",
      "100.128.0.1",
      "172.32.0.1",
      "2a00:1450:4001::1",
      // the same forms carrying a public IPv4 address stay public
      "::ffff:5db8:d822",
      "64:ff9b::5db8:d822",
    ])
      assert.equal(publicAddress(ok), true, ok);
    for (const bad of [
      "127.0.0.1",
      "0.0.0.0",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "100.64.0.1",
      "100.127.255.255",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      // barracuda, #1951: the other ways an IPv6 address carries a private IPv4 one
      "::ffff:7f00:1", // mapped, hex
      "0:0:0:0:0:ffff:a00:1", // mapped, written out
      "::7f00:1", // the old IPv4-compatible form
      "::a9fe:a9fe", // compatible 169.254.169.254
      "64:ff9b::7f00:1", // NAT64 to loopback
      "64:ff9b::6440:1", // NAT64 to the tailnet range
      "64:ff9b:1::1", // local-use NAT64
      "fec0::1", // the deprecated site-local
      "nem cim",
    ])
      assert.equal(publicAddress(bad), false, bad);
  });
});

describe("the PDF's text layer", () => {
  it("a section per page, the references list and what follows left out", async () => {
    const { sections, pagesDropped } = await pdfSections(
      await pdfOf(PDF_PAGES),
    );
    assert.equal(pagesDropped, 0);
    assert.deepEqual(
      sections.map((s) => s.locator),
      ["p. 1", "p. 2"],
    );
    // pdfjs gives the micro sign (U+00B5) as the Greek mu (U+03BC): the AI is
    // sent this text and quotes it, and the unit check reads both as "u"
    const asRead = (line: string) => line.replace(/\u00B5/g, "\u03BC");
    assert.ok(
      sections[0]!.text.includes(asRead(PDF_PAGES[0]![2]!)),
      sections[0]!.text,
    );
    assert.ok(sections[1]!.text.includes("4 \u03BCM phosphate"));
    assert.equal(sections[0]!.text.includes("\u00B5"), false);
    assert.equal(sections[1]!.text.includes("Kitalált Hivatkozás"), false);
    assert.equal(sections[1]!.text.includes("References"), false);
  });
});
