import { describe, expect, it } from "vitest";

import { formatFileSize } from "./file-size";

// What must fail: a megabyte size with the decimal point ("1.5 MB", toFixed's text, T1.5); a few
// hundred bytes reading "0 kB" as if the file were empty.
describe("formatFileSize", () => {
  it("writes megabytes with the decimal comma", () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2 MB");
  });

  it("writes kilobytes whole, never 0 kB", () => {
    expect(formatFileSize(300)).toBe("1 kB");
    expect(formatFileSize(20_480)).toBe("20 kB");
  });
});
