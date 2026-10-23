/**
 * A delimited-text reader that works on RECORDS, not lines.
 *
 * The supplier files quote fields that contain a line break (Hertlein: 8 of
 * 7431 records, Coralsands: 11 of 1568 on 2026-10-23), so "split on newline,
 * then on the delimiter" cuts a record in two and shifts every column after
 * it. A quote inside a quoted field is written doubled (""). A quote in the
 * middle of an unquoted field is plain text.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  // a last record without a closing newline (an empty tail is not a record)
  if (field !== "" || fieldStarted || record.length > 0) endRecord();
  return records;
}
