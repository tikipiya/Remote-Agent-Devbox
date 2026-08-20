import { describe, expect, it } from "vitest";

import { parseRawDiff } from "./raw-diff.js";

describe("parseRawDiff", () => {
  it("preserves non-UTF-8 path bytes as base64", () => {
    const header = Buffer.from(
      ":100644 100755 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M\0",
      "ascii"
    );
    const path = Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff, 0x2e, 0x74, 0x73, 0]);

    expect(parseRawDiff(Buffer.concat([header, path]), 10)).toEqual([
      {
        pathBase64: Buffer.from(path.subarray(0, -1)).toString("base64"),
        oldMode: "100644",
        newMode: "100755",
        oldBlob: "1111111111111111111111111111111111111111",
        newBlob: "2222222222222222222222222222222222222222",
        status: "M"
      }
    ]);
  });

  it("rejects rename records and malformed framing", () => {
    expect(() =>
      parseRawDiff(Buffer.from(":100644 100644 1111 2222 R100\0old\0new\0"), 10)
    ).toThrow("malformed raw diff");
    expect(() => parseRawDiff(Buffer.from("unterminated"), 10)).toThrow("not NUL terminated");
  });

  it("enforces the file limit", () => {
    const record = Buffer.from(":000000 100644 0000 2222 A\0path\0");
    expect(() => parseRawDiff(Buffer.concat([record, record]), 1)).toThrow("file limit");
  });
});
