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

/**
 * EGY CSATOLMANY. A `bytes` MAR KESZ: ez a hatar nem allit elo semmit.
 *
 * A lezart hibajegy csomagjat a `ServiceJobPackageService` gyartja, es ez a
 * felulet csak ATVESZI. Ha itt keletkezne, a levelkuldo hatara tudna a
 * hibajegyekrol -- es a kovetkezo kuldes-fajta (munkalap, szamla) ujra
 * kibontana ugyanezt.
 */
export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface OutgoingMail {
  /**
   * A CIMZETTEK. TOMB, NEM EGY CIM -- es a valtozas nem kenyelmi.
   *
   * A lezart hibajegy a HELYSZINT BIRTOKLOKNAK megy (Balazs specje,
   * 2026-09-18), ami tobb fiok is lehet.
   *
   * ES AMIERT NEM A FEJLEC-INJEKCIO AZ INDOK -- EZT A KALIBRACIO MUTATTA MEG.
   * Eloszor azt irtam ide, hogy egy osszefuzott listan az ellenorzes egyszer
   * futna, es egy rossz cim a tobbi moge bujhatna. LEMERVE: NEM IGAZ. A
   * `", "` mente osszefuzott szovegben a sortores MEGMARAD, tehat a
   * `hasHeaderInjection` ugyanugy elkapja. A rontas, ami az egyenkenti
   * ellenorzest osszefuzottre cserelte, ZOLD MARADT.
   *
   * AMIT A TOMB VALOBAN AD, es amire allitas is all:
   *   - a DARABSZAM ismert (`to.length`), tehat az ures lista MEGFOGHATO,
   *     es a naplo ki tudja irni, hany cimzettnek ment
   *   - az ELVALASZTO a level epitojenel dol el, nem a hivonal -- egy hivo
   *     nem adhat at vesszos szoveget, amit az epito EGY cimnek venne
   */
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  /** Ures vagy hianyzo lista mellett a level EGYRESZES marad. */
  readonly attachments?: readonly MailAttachment[];
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
