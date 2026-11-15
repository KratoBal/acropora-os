import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadOldShopLinkRules,
  rewriteOldShopLinks,
  type OldShopLinkRules,
} from "./medusa-description-links.js";

/**
 * A RÉGI BOLTRA MUTATÓ LEÍRÁS-LINKEK ÁTÍRÁSA (card aaf002d3). MI PIROSIT:
 * - egy leképezett link marad a régi hostra, vagy a cél rossz alakban megy ki;
 * - a nem régi hostú link (gyártói oldal) vagy a sima szövegben álló cím átíródik;
 * - a leképezetlen link elveszik, vagy nem kerül a jelentésbe;
 * - a lekérdezés-szöveges link átíródik (a lekérdezés jelentése elveszne);
 * - a kis/nagybetű, a záró perjel vagy a százalékkódolás eltérése miatt a szabály nem találja meg a linket;
 * - a második futás újra átír (nem idempotens);
 * - egy nem saját cél (`https://...`, `//...`) kerül a leírásba.
 */
const SZABALYOK: OldShopLinkRules = new Map([
  ["/valenciennea-bella", "/hu/termek/valenciennea-bella"],
  ["/eledelek", "/hu/categories/eledelek"],
  ["/ekezetes-út-é", "/hu/termek/ekezetes"],
  ["/kulso", "https://masik.example/x"],
  ["/protokoll-relativ", "//masik.example/x"],
]);

function link(href: string, szoveg = "x"): string {
  return `<a href="${href}">${szoveg}</a>`;
}

describe("rewriteOldShopLinks", () => {
  it("a leképezett régi-bolt linket a szabály céljára írja, a többi attribútum és a szöveg érintetlen", () => {
    const eredmeny = rewriteOldShopLinks(
      '<p><a class="k" href="https://shop.acropora.hu/Valenciennea-bella" target="_blank">Nézd</a></p>',
      SZABALYOK,
    );

    assert.equal(
      eredmeny.text,
      '<p><a class="k" href="/hu/termek/valenciennea-bella" target="_blank">Nézd</a></p>',
    );
    assert.equal(eredmeny.rewritten, 1);
    assert.deepEqual(eredmeny.unmapped, []);
  });

  it("mindkét régi host, a http és a protokoll-relatív alak, és az egy- és kétféle idézőjel is átíródik", () => {
    const html = [
      link("http://shop.acropora.hu/eledelek"),
      link("//www.shop.acropora.hu/eledelek"),
      link("https://acropora.unas.hu/eledelek"),
      "<a href='https://SHOP.ACROPORA.HU/eledelek'>x</a>",
    ].join(" ");

    const eredmeny = rewriteOldShopLinks(html, SZABALYOK);

    assert.equal(eredmeny.rewritten, 4);
    assert.equal(
      eredmeny.text,
      [
        link("/hu/categories/eledelek"),
        link("/hu/categories/eledelek"),
        link("/hu/categories/eledelek"),
        "<a href='/hu/categories/eledelek'>x</a>",
      ].join(" "),
    );
  });

  it("a kis/nagybetű, a záró perjel és a százalékkódolt út ugyanazt a szabályt találja", () => {
    const eredmeny = rewriteOldShopLinks(
      [
        link("https://shop.acropora.hu/VALENCIENNEA-Bella/"),
        link("https://shop.acropora.hu/Ekezetes-%C3%BAt-%C3%A9"),
        link("https://shop.acropora.hu/ekezetes-út-é"),
      ].join(""),
      SZABALYOK,
    );

    assert.equal(eredmeny.rewritten, 3);
    assert.deepEqual(eredmeny.unmapped, []);
  });

  it("az utat EGYSZER dekódolja: egy `%2541` a `/a%41` szabályt találja, nem az `/aA`-t", () => {
    const szabalyok: OldShopLinkRules = new Map([
      ["/a%41", "/hu/termek/szazalek"],
      ["/aa", "/hu/termek/dupla-dekodolt"],
    ]);

    const eredmeny = rewriteOldShopLinks(
      link("https://shop.acropora.hu/a%2541"),
      szabalyok,
    );

    assert.equal(eredmeny.text, link("/hu/termek/szazalek"));
  });

  it("a `#` töredék megmarad, a lekérdezés-szöveges link érintetlen és leképezetlenként számol", () => {
    const eredmeny = rewriteOldShopLinks(
      [
        link("https://shop.acropora.hu/eledelek#ajanlat"),
        link("https://shop.acropora.hu/eledelek?sort=ar"),
      ].join(""),
      SZABALYOK,
    );

    assert.equal(
      eredmeny.text,
      link("/hu/categories/eledelek#ajanlat") +
        link("https://shop.acropora.hu/eledelek?sort=ar"),
    );
    assert.equal(eredmeny.rewritten, 1);
    assert.deepEqual(eredmeny.unmapped, ["/eledelek"]);
  });

  it("a leképezetlen régi-bolt link érintetlen marad, és a jelentésben az úttal szerepel", () => {
    const html = link(
      "https://shop.acropora.hu/spg/821031,2630685/Doktorhalak",
    );

    const eredmeny = rewriteOldShopLinks(html, SZABALYOK);

    assert.equal(eredmeny.text, html);
    assert.equal(eredmeny.rewritten, 0);
    assert.deepEqual(eredmeny.unmapped, ["/spg/821031,2630685/Doktorhalak"]);
  });

  it("nem régi hostú link és a sima szövegben álló cím érintetlen", () => {
    const html =
      link("https://www.aquaforest.eu/termek") +
      " Lásd shop.acropora.hu/eledelek a boltban. " +
      '<img src="https://shop.acropora.hu/kep.jpg">';

    const eredmeny = rewriteOldShopLinks(html, SZABALYOK);

    assert.equal(eredmeny.text, html);
    assert.equal(eredmeny.rewritten, 0);
    assert.deepEqual(eredmeny.unmapped, []);
  });

  it("a nem saját cél (abszolút vagy protokoll-relatív) nem kerül a leírásba: a link leképezetlen", () => {
    const html =
      link("https://shop.acropora.hu/kulso") +
      link("https://shop.acropora.hu/protokoll-relativ");

    const eredmeny = rewriteOldShopLinks(html, SZABALYOK);

    assert.equal(eredmeny.text, html);
    assert.equal(eredmeny.rewritten, 0);
    assert.equal(eredmeny.unmapped.length, 2);
  });

  it("a HTML-be nem biztonságos cél (idézőjel, `<`, `>`, `&`, szóköz, százalékkódolt idézőjel) nem kerül a leírásba: a link leképezetlen", () => {
    const veszelyes: OldShopLinkRules = new Map([
      ["/a", '/x"onmouseover="alert(1)'],
      ["/b", "/x'y"],
      ["/c", "/x<y"],
      ["/d", "/x>y"],
      ["/e", "/x?a=1&b=2"],
      ["/f", "/x y"],
      ["/g", "/x\ty"],
    ]);
    const html = ["a", "b", "c", "d", "e", "f", "g"]
      .map((betu) => link(`https://shop.acropora.hu/${betu}`))
      .join("");

    const eredmeny = rewriteOldShopLinks(html, veszelyes);

    assert.equal(eredmeny.text, html);
    assert.equal(eredmeny.rewritten, 0);
    assert.equal(eredmeny.unmapped.length, 7);
  });

  it("a böngésző által másik domainnek vett cél (`/\\masik.example`, `/x\\y`) a KÖZÖS saját-út ellenőrzésen elbukik", () => {
    const html =
      link("https://shop.acropora.hu/h") + link("https://shop.acropora.hu/i");
    const eredmeny = rewriteOldShopLinks(
      html,
      new Map([
        ["/h", "/\\masik.example"],
        ["/i", "/x\\y"],
      ]),
    );

    assert.equal(eredmeny.text, html);
    assert.equal(eredmeny.rewritten, 0);
  });

  it("idempotens: az átírt szövegen a második futás nem ír át semmit", () => {
    const egyszer = rewriteOldShopLinks(
      link("https://shop.acropora.hu/Valenciennea-bella"),
      SZABALYOK,
    );

    const ketszer = rewriteOldShopLinks(egyszer.text, SZABALYOK);

    assert.equal(ketszer.text, egyszer.text);
    assert.equal(ketszer.rewritten, 0);
  });

  it("a `null` leírás `null` marad, az üres szabálykészlet nem ír át semmit", () => {
    assert.deepEqual(rewriteOldShopLinks(null, SZABALYOK), {
      text: null,
      rewritten: 0,
      unmapped: [],
    });
    const html = link("https://shop.acropora.hu/eledelek");
    const ures = rewriteOldShopLinks(html, new Map());
    assert.equal(ures.text, html);
    assert.deepEqual(ures.unmapped, ["/eledelek"]);
  });
});

describe("loadOldShopLinkRules", () => {
  it("csak az AKTÍV szabályokat kéri, egy lekérdezéssel, és a kisbetűs forrás-útból térképet épít", async () => {
    const hivasok: unknown[] = [];
    const db = {
      urlRedirect: {
        findMany: async (args: unknown) => {
          hivasok.push(args);
          return [
            { sourcePathLower: "/a", destinationPath: "/hu/termek/a" },
            { sourcePathLower: "/b", destinationPath: "/hu/categories/b" },
          ];
        },
      },
    };

    const szabalyok = await loadOldShopLinkRules(
      db as unknown as Parameters<typeof loadOldShopLinkRules>[0],
    );

    assert.deepEqual(hivasok, [
      {
        where: { isActive: true },
        select: { sourcePathLower: true, destinationPath: true },
      },
    ]);
    assert.deepEqual(
      [...szabalyok],
      [
        ["/a", "/hu/termek/a"],
        ["/b", "/hu/categories/b"],
      ],
    );
  });
});
