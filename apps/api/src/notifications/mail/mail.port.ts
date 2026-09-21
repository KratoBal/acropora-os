/**
 * A LEVELKULDO INTERFESZE -- A HIVO NE TUDJON A GMAILROL.
 *
 * acrobot masodik kikotese (2026-09-21): "a Gmail ma jo valasztas, de az
 * egyetlen dolog, amit biztosan tudunk egy kulso szolgaltatorol, hogy egyszer
 * lecsereljuk".
 *
 * A HATAR ITT EGY MEZO-KESZLET, NEM EGY OSZTALY: a cimzett, a targy es a
 * szoveg minden szolgaltatonal ugyanaz. Ami szolgaltato-fuggo (hitelesites,
 * kodolas, hibakodok), az az implementacioban marad.
 */

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailSender {
  /**
   * DOB, HA NEM SIKERULT. Nem `boolean`-t ad vissza, es ez szandekos: egy
   * `false` visszateresi erteket a hivo ELNYELHET anelkul, hogy barhol nyoma
   * maradna. Ugyanaz a tanulsag, mint az androidos kuldonel (7ef5402f):
   * a kuldes sikeret NE a visszateresi ertekbol allitsuk.
   */
  send(mail: OutgoingMail): Promise<void>;
}

export const MAIL_SENDER = Symbol("MAIL_SENDER");
