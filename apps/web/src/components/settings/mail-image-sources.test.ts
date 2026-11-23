import { describe, expect, it } from "vitest";

import { withImageSources } from "./mail-image-picker";

/**
 * AZ ELONEZET KEPEI (OS hibakor 3, 2026-11-20): a Levelsablonok lapon a keret
 * egy fel nem oldott `acropora-image:` hivatkozast kapott, es a bongeszo
 * `net::ERR_UNKNOWN_URL_SCHEME`-et irt a konzolra. MI PIROSIT: a feloldatlan
 * sajat hivatkozas `src`-kent a keretbe jut; a feloldott nem kapja meg a
 * cimet; egy mas semaju `src` megvaltozik.
 */
describe("withImageSources: az elonezet keretebe nem jut sajat hivatkozas", () => {
  const sources = new Map([["abc123", "data:image/png;base64,AAAA"]]);

  it("a feloldott sajat kep a betoltott cimet kapja", () => {
    expect(
      withImageSources(
        '<p><img src="acropora-image:abc123" alt="a"></p>',
        sources,
      ),
    ).toBe('<p><img src="data:image/png;base64,AAAA" alt="a"></p>');
  });

  it("a fel nem oldott sajat kep src nelkul marad (nem ismeretlen semaval)", () => {
    const html = withImageSources(
      '<p><img src="acropora-image:nincs999" alt="b"></p>',
      sources,
    );
    expect(html).not.toContain("acropora-image:");
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).toContain('alt="b"');
  });

  it("a mas semaju src-hez nem nyul", () => {
    const html = '<img src="https://cdn.example.hu/a.jpg" alt="c">';
    expect(withImageSources(html, sources)).toBe(html);
  });
});
