import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InlineImageMailSender } from "./inline-image.mail-sender.js";
import type { MailSender, OutgoingMail } from "./mail.port.js";
import type { MailImageContent } from "./mail-image.repository.js";

/** A BELSO KULDO HELYETT EGY GYUJTO: megjegyzi, MIT kapott. */
function gyujto(): MailSender & { kapott: OutgoingMail[] } {
  const kapott: OutgoingMail[] = [];
  return {
    kapott,
    async send(mail) {
      kapott.push(mail);
    },
  };
}

const LOGO: MailImageContent = {
  id: "logo1",
  fileName: "logo.png",
  contentType: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71]),
};

function kuldo(kepek: readonly MailImageContent[] = [LOGO]) {
  const belso = gyujto();
  const kerdezett: string[][] = [];
  const sender = new InlineImageMailSender(belso, {
    contents: async (ids) => {
      kerdezett.push([...ids]);
      return kepek.filter((kep) => ids.includes(kep.id));
    },
  });
  return { belso, sender, kerdezett };
}

const LEVEL: OutgoingMail = {
  to: ["vevo@partner.hu"],
  subject: "Vízmérés",
  text: "Logó\n\nKedves Anna!",
};

describe("a kép-feloldó burok", () => {
  it("a saját hivatkozást cid:-re cseréli, és a képet mellékeli", async () => {
    const { belso, sender } = kuldo();
    await sender.send({
      ...LEVEL,
      html: '<p><img src="acropora-image:logo1" alt="Logó"></p><p>Kedves Anna!</p>',
    });
    assert.deepEqual(belso.kapott, [
      {
        ...LEVEL,
        html: '<p><img src="cid:logo1@acropora" alt="Logó"></p><p>Kedves Anna!</p>',
        inlineImages: [
          {
            contentId: "logo1@acropora",
            filename: "logo.png",
            contentType: "image/png",
            bytes: LOGO.bytes,
          },
        ],
      },
    ]);
  });

  /*
    A KETSZER BESZURT LOGO EGYSZER MEGY: a MIME-epito a ketszer mellekelt kepet
    elutasitana, tehat itt kell egyetlen mellekletté valnia.
  */
  it("a kétszer hivatkozott kép egyszer kerül mellékletbe", async () => {
    const { belso, sender } = kuldo();
    await sender.send({
      ...LEVEL,
      html: '<p><img src="acropora-image:logo1"></p><p><img src="acropora-image:logo1"></p>',
    });
    assert.equal(belso.kapott[0]?.inlineImages?.length, 1);
    assert.equal(
      belso.kapott[0]?.html,
      '<p><img src="cid:logo1@acropora"></p><p><img src="cid:logo1@acropora"></p>',
    );
  });

  it("kép nélküli levelet VÁLTOZATLANUL ad tovább, adatbázis-kérdés nélkül", async () => {
    const { belso, sender, kerdezett } = kuldo();
    const formazott = { ...LEVEL, html: "<p>Kedves Anna!</p>" };
    await sender.send(formazott);
    await sender.send(LEVEL);
    assert.equal(belso.kapott[0], formazott);
    assert.equal(belso.kapott[1], LEVEL);
    assert.deepEqual(kerdezett, []);
  });

  /**
   * A HIANYZO KEP MEGALLITJA A LEVELET, ES MEGNEVEZI. Egy csendben kihagyott
   * logo a vevonek ures helyet mutatna, es senki nem tudna rola.
   */
  it("hiányzó képnél nem küld, és a hibában megnevezi az azonosítót", async () => {
    const { belso, sender } = kuldo([]);
    await assert.rejects(
      () =>
        sender.send({
          ...LEVEL,
          html: '<p><img src="acropora-image:logo1"></p>',
        }),
      /logo1/,
    );
    assert.deepEqual(belso.kapott, []);
  });
});
