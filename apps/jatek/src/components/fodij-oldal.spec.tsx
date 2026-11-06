import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { FodijOldal } from "./fodij-oldal.tsx";
import { FodijVilagitas } from "./fodij-vilagitas.tsx";

/*
  WHAT TURNS THIS RED (the prize page, AF Nano Tank). A section of the original page missing or out of order; an image
  that points at a file that is not in `public` (a broken picture on the live page); an image without a description
  (the original has none, ours must); the footer, the newsletter or the cookie bar of the source page coming along (the
  owner asked for none: 2026-11-06); the video autoplaying, with sound, or loading its 2.6 MB at page load; the two
  buttons pointing nowhere; English text of the source left in the Hungarian page; the day/night switch without its
  states. The nine sections are the original's, in the original's order.
*/
const PUBLIC = join(process.cwd(), "public");
const html = renderToStaticMarkup(<FodijOldal />);
const h2k = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) =>
  m[1]!.replace(/<[^>]+>/g, "").trim(),
);

describe("a fődíj-oldal", () => {
  it("has the nine sections of the original, in its order, in Hungarian", () => {
    assert.deepEqual(h2k, [
      "TENGER A DOBOZBAN",
      "TELJES, KÉSZ, TÖKÉLETES",
      "A SAJÁT ABLAKOD AZ ÓCEÁNRA",
      "MINDEN, AMI KELL, EGY CSOMAGBAN",
      "A DOBOZTÓL A SZIRTIG, NÉHÁNY EGYSZERŰ LÉPÉSBEN",
      "MIÉRT AZ AF NANO TANK?",
      "VILÁGÍTÁS, AMI TÖKÉLETES HANGULATOT TEREMT",
      "TÖKÉLETES VÁLASZTÁS",
      "MI VAN A DOBOZBAN?",
      "KOCKA ALAKÚ KAPU A TISZTA NYUGALOMHOZ",
    ]);
  });

  it("keeps out the footer, the newsletter and the cookie bar of the source page", () => {
    assert.doesNotMatch(html, /<footer|newsletter|hírlevél|cookie|süti/i);
    assert.doesNotMatch(html, /Subscribe|Privacy|Contact|Where to buy/);
  });

  it("every image is an existing file under public, and a picture that is not decoration has a description", () => {
    const kepek = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    // hero 1, ikon 4, termek 6, lepes 6, miert 4, kinek 4, zaro 1, vilagitas 1: a pontos szam, hogy egy hianyzo kep is bukjon
    assert.equal(kepek.length, 27);
    for (const t of kepek) {
      const src = /src="([^"]+)"/.exec(t)![1]!;
      assert.ok(existsSync(join(PUBLIC, src)), `missing file: ${src}`);
      const dekor = /aria-hidden="true"/.test(t);
      const alt = /alt="([^"]*)"/.exec(t)?.[1] ?? null;
      assert.ok(alt !== null, `no alt attribute: ${src}`);
      if (!dekor) assert.ok(alt!.length >= 10, `no description: ${src}`);
    }
  });

  it("the video does not autoplay, does not load before it is played, and has a poster and controls", () => {
    const video = /<video\b[^>]*>/.exec(html)![0];
    assert.doesNotMatch(video, /autoplay/i);
    assert.match(video, /preload="none"/);
    assert.match(video, /controls/);
    assert.match(video, /muted/);
    assert.match(video, /poster="\/fodij\/video-poszter\.jpg"/);
    for (const f of ["video.mp4", "video-poszter.jpg"])
      assert.ok(existsSync(join(PUBLIC, "fodij", f)), f);
  });

  // WHAT TURNS THIS RED (Balázs's text corrections, 2026-11-06 evening, exchange/jatek/szovegjavitas-balazs-2026-11-06.md): the
  // word "zátony" (or "zátonyakvárium", "zátonysó", "zátonyos") coming back anywhere on the prize page or its metadata; the
  // filter part called "Szűrőpanel" again instead of "Szűrőház"; one of the sentences he rewrote reading as before.
  it("carries Balázs's wording: no 'zátony' anywhere, 'Szűrőház', the rewritten sentences", () => {
    const forrasok = [
      "src/components/fodij-oldal.tsx",
      "src/components/fodij-vilagitas.tsx",
      "src/app/fodij/page.tsx",
    ].map((f) => readFileSync(join(process.cwd(), f), "utf8"));
    for (const forras of forrasok) {
      assert.doesNotMatch(forras, /zátony/i);
      assert.doesNotMatch(forras, /szűrőpanel/i);
    }
    const szoveg = html
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    assert.doesNotMatch(szoveg, /zátony|szűrőpanel/i);
    for (const mondat of [
      "Tengeri akváriumot indítani még sosem volt ilyen egyszerű.",
      "ami az első sósvízi akváriumod felépítéséhez kell",
      "tengersót, dekorkövet, homokot és a nélkülözhetetlen indító baktériumokat.",
      "Egyszerű összeállítás, még ha ez az első tengeri akváriumod is.",
      "KORALLOS LED-VILÁGÍTÁS",
      "Első korallos akváriumnak",
      "Nano akvárium rajongóknak",
      "Szűrőház",
      "Hozz létre virágzó tengeri ökoszisztémát egy teljes készlettel, amelyet úgy terveztünk, hogy az első naptól egyszerű, szép és sikeres legyen.",
      "Csomagold ki az akváriumodat",
    ])
      assert.ok(szoveg.includes(mondat), mondat);
    assert.ok(html.includes('alt="Reef Salt tengeri só zacskója"'));
    assert.ok(
      html.includes("Bemutató videó: az AF Nano Tank koralljai közelről"),
    );
    assert.match(forrasok[2]!, /teljes tengeri akvárium-készlet/);
  });

  it("the two buttons lead to the kit section and to the weekly question", () => {
    assert.match(html, /href="#keszlet"[^>]*>ISMERD MEG A KÉSZLETET/);
    assert.match(html, /id="keszlet"/);
    assert.match(
      html,
      /href="\/#heti-kerdes"[^>]*>KEZDD EL MA A SÓSVÍZI UTAZÁSODAT/,
    );
  });

  it("carries the table rows of the original in Hungarian", () => {
    for (const s of [
      "45 × 45 × 45 cm",
      "90 L bruttó / 85 L nettó",
      "6 mm Super White",
      "1000 L/h DC keringető szivattyú",
      "90 LED, 18 W",
      "2 × 2 kg",
      "3,5 kg",
    ])
      assert.ok(html.includes(s), s);
    assert.doesNotMatch(
      html,
      /Tank dimensions|Capacity|Glass\b|Filtration Panel/,
    );
  });
});

describe("a nappal / éjszaka kapcsoló", () => {
  const h = renderToStaticMarkup(<FodijVilagitas />);

  it("starts in the day, with both states in a labelled group and the day's picture and caption", () => {
    assert.match(h, /aria-label="Nappal \/ Éjszaka"/);
    assert.match(h, /aria-pressed="true"[^>]*>NAPPAL/);
    assert.match(h, /aria-pressed="false"[^>]*>ÉJSZAKA/);
    assert.match(h, /vilagitas-nappal\.webp/);
    assert.match(h, /Gyönyörű fények nappal/);
    // the night properties appear only in the night
    assert.doesNotMatch(h, /Állítható fényerő|Kék és RGB/);
  });

  it("the four pictures exist, and the source has the click handlers for the night properties", () => {
    for (const f of ["nappal", "ejszaka", "fenyero", "rgb"])
      assert.ok(existsSync(join(PUBLIC, "fodij", `vilagitas-${f}.webp`)), f);
    const forras = readFileSync(
      join(process.cwd(), "src", "components", "fodij-vilagitas.tsx"),
      "utf8",
    );
    assert.match(forras, /Állítható fényerő/);
    assert.match(forras, /Kék és RGB csatornák/);
  });
});
