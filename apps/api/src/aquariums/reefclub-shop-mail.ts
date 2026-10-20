import type { OutgoingMail } from "../notifications/mail/mail.port.js";

/**
 * THE THREE E-MAILS OF THE SHOP LINK AND THE RELEASE (ReefClub plan v6.1, 3.3
 * and 3.5; slice 5), sent by the INTERNAL process with the shop's own sender.
 * Plain text, no measurement value in any of them: the values stay behind
 * the ReefClub login (plan 3.5).
 */

/** A moment as a person in Hungary reads it. */
export function budapestMoment(moment: Date): string {
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(moment);
}

/** The code, when the colleague asks for it to go to the customer's address. */
export function linkCodeMail(input: {
  to: string;
  customerName: string;
  code: string;
  expiresAt: Date;
  webUrl: string;
}): OutgoingMail {
  return {
    to: [input.to],
    subject: "ReefClub: a bolti összekapcsolás kódja",
    text: [
      `Kedves ${input.customerName}!`,
      "",
      "A ReefClub-fiókodat ezzel a kóddal kapcsolhatod össze a boltban nyilvántartott akváriumaiddal:",
      "",
      `    ${input.code}`,
      "",
      `A kód egyszer használható, és ${budapestMoment(input.expiresAt)}-ig érvényes.`,
      `Beváltás a ReefClubban, belépés után: ${input.webUrl}/bolti-kod`,
      "",
      "Ha nem kértél kódot, nincs teendőd: a kód magától lejár.",
      "",
      "Acropora",
    ].join("\n"),
  };
}

/**
 * EVERY NEW LINK IS TOLD TO THE CUSTOMER (barracuda, the plan's v1 review):
 * several accounts can be linked to one customer, so a code that went to the
 * wrong hands must be noticed, not silent. It names the account and the
 * moment, and how to end it.
 */
export function linkNoticeMail(input: {
  to: string;
  customerName: string;
  accountEmail: string;
  linkedAt: Date;
  shopAddress: string | undefined;
}): OutgoingMail {
  const contact = input.shopAddress
    ? `írj nekünk ide: ${input.shopAddress}`
    : "válaszolj erre a levélre";
  return {
    to: [input.to],
    subject: "ReefClub: új fiók kapcsolódott a bolti adataidhoz",
    text: [
      `Kedves ${input.customerName}!`,
      "",
      `${budapestMoment(input.linkedAt)}-kor a(z) ${input.accountEmail} ReefClub-fiók összekapcsolódott a boltban nyilvántartott akváriumaiddal. A fiók ezentúl látja ezeknek az akváriumoknak az adatait és a véglegesített vízméréseit.`,
      "",
      "Ha ezt te vagy egy családtagod tette, nincs teendőd.",
      `Ha nem, ${contact}, és megszüntetjük az összekapcsolást. A fiók gazdája a ReefClubban maga is bármikor megszüntetheti.`,
      "",
      "Acropora",
    ].join("\n"),
  };
}

/** A released shop measurement, to a linked account that asked for it. */
export function releaseMail(input: {
  to: string;
  aquariumName: string;
  aquariumId: string;
  webUrl: string;
}): OutgoingMail {
  return {
    to: [input.to],
    subject: `ReefClub: új bolti vízmérés, ${input.aquariumName}`,
    text: [
      "Szia!",
      "",
      `A boltban mért vízmérés eredménye a(z) ${input.aquariumName} akváriumodhoz elérhető a ReefClubban:`,
      `${input.webUrl}/akvariumok/${input.aquariumId}`,
      "",
      "Az értesítést a ReefClub beállításaiban kapcsolhatod ki.",
      "",
      "Acropora ReefClub",
    ].join("\n"),
  };
}
