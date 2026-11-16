import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STRIP_LINKS_ENV,
  findLinks,
  stripExternalLinks,
  stripExternalLinksDeep,
  stripLinksEnabled,
} from "./ai-product-search.links.js";
import { IANA_TLDS } from "./ai-product-search.tlds.js";

/**
 * THE PROJECTION'S LINK STRIPPING (card 9d060f5c, R3). The recognition is a copy of the AI service's answer gate
 * (acropora-ai-agent #75), so the rows of its matrix that decide what is an address are repeated here. WHAT TURNS
 * IT RED: an external address left in the text under a disguise (no scheme, bracketed, spelled out, IDN, an IP,
 * our name as a prefix or a suffix or userinfo); our own domain removed; ordinary text taken for an address; the
 * cut leaving the wrong text around it; the switch on for anything but exactly `true`.
 */
describe("the TLD copy", () => {
  it("is the snapshot of more than a thousand TLDs, punycode for IDN", () => {
    assert.ok(IANA_TLDS.size > 1000);
    for (const tld of ["com", "hu", "ca", "xn--p1ai"])
      assert.ok(IANA_TLDS.has(tld), tld);
  });
});

describe("the AI_PRODUCT_SEARCH_STRIP_LINKS switch", () => {
  it("is on only for exactly `true`", () => {
    assert.equal(stripLinksEnabled({ [STRIP_LINKS_ENV]: "true" }), true);
    for (const value of [undefined, "", "false", "TRUE", "1", " true"])
      assert.equal(
        stripLinksEnabled({ [STRIP_LINKS_ENV]: value }),
        false,
        JSON.stringify(value),
      );
  });
});

describe("stripExternalLinks", () => {
  it("takes out every form of external address, and our own domain stays", () => {
    for (const [input, output, hosts] of [
      [
        "Részletek: https://www.reefsupplies.ca/x itt.",
        "Részletek: itt.",
        ["www.reefsupplies.ca"],
      ],
      ["Lásd //evil.com/x oldalt.", "Lásd oldalt.", ["evil.com"]],
      ["Lásd www.evil.com oldalt.", "Lásd oldalt.", ["www.evil.com"]],
      ["Rendeld a reefsupplies.ca-n.", "Rendeld a.", ["reefsupplies.ca"]],
      [
        "Szerver: http://203.0.113.5/x és [2001:db8::1].",
        "Szerver: és.",
        ["203.0.113.5", "2001:db8::1"],
      ],
      ["Lásd evil[.]com és evil pont com.", "Lásd és.", ["evil.com"]],
      ["A gyártó: [itt](https://x.com).", "A gyártó: [itt].", ["x.com"]],
      ["Lásd ácropora.hu oldalt.", "Lásd oldalt.", ["xn--cropora-gwa.hu"]],
      [
        "Lásd acropora.hu.evil.com és evil-acropora.hu.",
        "Lásd és.",
        ["acropora.hu.evil.com", "evil-acropora.hu"],
      ],
      [
        "Lásd https://shop.acropora.hu@evil.com/x oldalt.",
        "Lásd oldalt.",
        ["evil.com"],
      ],
    ] as const) {
      const stripped = stripExternalLinks(input);
      assert.deepEqual([stripped.text, stripped.hosts], [output, hosts], input);
    }
  });

  it("our own domain and its subdomains stay as written", () => {
    for (const text of [
      "Nálunk: https://shop.acropora.hu/termek/x és acropora.hu.",
      "Lásd az acropora.hu-n.",
      "Itt (HTTPS://Shop.Acropora.hu/x).",
    ])
      assert.deepEqual(stripExternalLinks(text), { text, hosts: [] }, text);
  });

  it("ordinary text is not an address and stays untouched", () => {
    for (const text of [
      "A pH 8.2 legyen, a dKH 7.5.",
      "Adj 1.5 ml-t belőle.",
      "A Balling.Light készlet is jó, a manual.pdf fájlban.",
      "A cikkszáma AB.12, az x.y alak nem cím.",
      "Pl. a kalcium, stb. is számít.",
      "Ez pont az, amit kerestél.",
      "Ebben az időpontban a szempontok mások.",
      "5 < 10 mg, (lásd lent).",
    ]) {
      assert.deepEqual(findLinks(text), [], text);
      assert.deepEqual(stripExternalLinks(text), { text, hosts: [] }, text);
    }
  });

  it("the parameters: every string value at any depth, keys untouched, other values as they are", () => {
    const hosts = new Set<string>();
    assert.deepEqual(
      stripExternalLinksDeep(
        {
          adatlap: "http://pelda.hu/adatlap.pdf",
          "gyarto.com": "Gyártó: gyarto.com",
          lista: ["sima szöveg", "lásd www.x.com"],
          meret: 12,
          aktiv: true,
          ures: null,
        },
        hosts,
      ),
      {
        adatlap: "",
        "gyarto.com": "Gyártó:",
        lista: ["sima szöveg", "lásd"],
        meret: 12,
        aktiv: true,
        ures: null,
      },
    );
    assert.deepEqual([...hosts], ["pelda.hu", "gyarto.com", "www.x.com"]);
  });
});
