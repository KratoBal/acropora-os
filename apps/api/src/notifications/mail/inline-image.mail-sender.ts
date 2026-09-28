import { RICH_TEXT_IMAGE_SCHEME, richImageIds } from "@acropora/rich-text";
import { Inject, Injectable } from "@nestjs/common";

import { GmailMailSender } from "./gmail-mail.sender.js";
import type { MailInlineImage, MailSender, OutgoingMail } from "./mail.port.js";
import { MailImageRepository } from "./mail-image.repository.js";

/**
 * A SABLON KEPEIT A LEVELBE AGYAZZA -- inline CID mellekletkent.
 *
 * Balazs kerese, 2026-09-28 07:39 UTC: kep (pl. az Acropora logo) a
 * levelsablonban. acrobot dontese: a kep a LEVELBE AGYAZVA megy ki, nem kulso
 * URL-kent (sok levelezo blokkolja) es nem `data:` URI-kent (a Gmail nem
 * mutatja).
 *
 * === MIERT BUROK, ES MIERT ITT ===
 *
 * Ot kuldesi ut rendereli a sablont (negy hibajegy-level es a vizmeres). Ha a
 * kep feloldasa a hivokban allna, az a hely, amelyik kimarad, a vevonek egy
 * `acropora-image:` hivatkozast kuldene, amit semmi nem tud megjeleniteni.
 * A MIME-epito ezt kulon dobassal allitja meg (`MAIL_INLINE_IMAGE_UNRESOLVED`),
 * tehat a level el sem menne. Ugyanaz az alak, mint az atiranyito buroknal:
 * EGY hely, amin mindenki atmegy.
 *
 * A LANC: `MAIL_SENDER` -> atiranyito burok -> EZ -> Gmail.
 *
 * === A HIANYZO KEP MEGALLITJA A LEVELET ===
 *
 * A mentes ellenorzi, hogy a hivatkozott kep letezik, es torles nincs. Ha megis
 * hianyzik, az adatbazis-szintu beavatkozas nyoma -- es egy csendben kihagyott
 * kep (egy logo helyen semmi) rosszabb, mint egy megnevezett, naplozott hiba.
 */
@Injectable()
export class InlineImageMailSender implements MailSender {
  constructor(
    @Inject(GmailMailSender) private readonly inner: MailSender,
    @Inject(MailImageRepository)
    private readonly images: Pick<MailImageRepository, "contents">,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const ids = mail.html === undefined ? [] : richImageIds(mail.html);
    if (ids.length === 0) return this.inner.send(mail);

    const kepek = await this.images.contents(ids);
    const hianyzo = ids.filter((id) => !kepek.some((kep) => kep.id === id));
    if (hianyzo.length)
      throw new Error(
        `A levélben hivatkozott kép nem található: ${hianyzo.join(", ")}.`,
      );

    const cid = (id: string) => `${id}@acropora`;
    const html = (mail.html as string).replace(
      /(<img[^>]*\ssrc=")([^"]*)"/g,
      (egesz, eleje: string, src: string) =>
        src.startsWith(RICH_TEXT_IMAGE_SCHEME)
          ? `${eleje}cid:${cid(src.slice(RICH_TEXT_IMAGE_SCHEME.length))}"`
          : egesz,
    );
    const inlineImages: MailInlineImage[] = ids.map((id) => {
      const kep = kepek.find((k) => k.id === id) as (typeof kepek)[number];
      return {
        contentId: cid(id),
        filename: kep.fileName,
        contentType: kep.contentType,
        bytes: kep.bytes,
      };
    });
    return this.inner.send({ ...mail, html, inlineImages });
  }
}
