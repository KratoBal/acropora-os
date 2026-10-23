import { parseCoralsandsPreisliste } from "./coralsands-preisliste.parser.js";
import { parseDeJongStocklist } from "./dejong-stocklist.parser.js";
import { parseHertleinArtikel } from "./hertlein-artikel.parser.js";
import {
  PriceListParseError,
  type ParsedPriceList,
  type PriceListFormat,
} from "./price-list.types.js";

/** The largest file accepted (the missing-invoice upload and the PDF attach use the same 15 MB). */
export const MAX_PRICE_LIST_BYTES = 15 * 1024 * 1024;

/**
 * More rejected rows than this share of the rows read means the file is not
 * what the uploader said it was (a Hertlein file uploaded as a De Jong list
 * rejects almost every row) or is damaged. The whole file is then refused
 * instead of being saved with a pile of rejected rows.
 *
 * Measured on 2026-10-23 on the three real files: De Jong rejects 0 of 7075
 * rows (575 of its prices needed the spreadsheet-float cleaning), Hertlein 0 of
 * 7430 (166 identical repeats are counted separately, not rejected), Coralsands
 * 0 of 1566. A threshold of 10% sits far above any of them and far below a
 * wrong-format upload.
 */
export const MAX_REJECTED_SHARE = 0.1;

/**
 * Text of a file: UTF-8 (with or without a byte-order mark), else
 * Windows-1252, which is what a spreadsheet exported on a German or Dutch
 * machine writes. Windows-1252 never fails to decode (every byte maps to a
 * character), so a file that is neither text encoding (a zip, a spreadsheet, a
 * PDF uploaded by mistake) is recognised by the control characters it
 * produces, and refused instead of being read as product names.
 */
export function decodePriceListText(buffer: Buffer): string {
  const withoutBom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(withoutBom);
  } catch {
    // fall through to the single-byte code page
  }
  const text = new TextDecoder("windows-1252").decode(withoutBom);
  // C1 controls (U+0080-U+009F) are the bytes Windows-1252 leaves undefined
  if (/[\u0080-\u009f\u0000]/.test(text))
    throw new PriceListParseError("UNREADABLE_ENCODING");
  return text;
}

/**
 * The entry point of the price-list parsers. THE FORMAT IS THE UPLOADER'S
 * CHOICE and is never guessed from the content: the caller passes it, and a
 * file that does not fit it is refused as a whole (header missing, no valid
 * row, or too many rejected rows). A file that fits but holds a few unreadable
 * rows is returned with those rows in `rejected`, for the summary to show.
 */
export function parsePriceList(
  format: PriceListFormat,
  buffer: Buffer,
): ParsedPriceList {
  if (buffer.length > MAX_PRICE_LIST_BYTES)
    throw new PriceListParseError("FILE_TOO_LARGE");
  const text = decodePriceListText(buffer);
  const parsed =
    format === "DEJONG_STOCKLIST"
      ? parseDeJongStocklist(text)
      : format === "HERTLEIN_ARTIKEL"
        ? parseHertleinArtikel(text)
        : parseCoralsandsPreisliste(text);
  if (parsed.entries.length === 0)
    throw new PriceListParseError("NO_VALID_ROWS");
  const read = parsed.entries.length + parsed.rejected.length;
  if (parsed.rejected.length / read > MAX_REJECTED_SHARE)
    throw new PriceListParseError("TOO_MANY_REJECTED_ROWS");
  return parsed;
}
