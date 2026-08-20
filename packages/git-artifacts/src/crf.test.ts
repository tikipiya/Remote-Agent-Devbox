import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalizeFiles, digestCanonical } from "./crf.js";

describe("CRF-1 canonicalization", () => {
  it("is independent of object insertion order", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: "x" } })).toBe(
      canonicalJson({ a: { b: "x", y: true }, z: 1 })
    );
    expect(digestCanonical({ b: 2, a: 1 })).toBe(digestCanonical({ a: 1, b: 2 }));
  });

  it("sorts paths by their raw byte identity", () => {
    const common = {
      oldBlob: "0".repeat(40),
      newBlob: "1".repeat(40),
      oldMode: "100644",
      newMode: "100644",
      status: "M" as const
    };
    const files = canonicalizeFiles([
      { ...common, pathBase64: Buffer.from([0xff]).toString("base64") },
      { ...common, pathBase64: Buffer.from([0x01]).toString("base64") }
    ]);
    expect(files.map((file) => Buffer.from(file.pathBase64, "base64")[0])).toEqual([1, 255]);
  });

  it("rejects ambiguous values and duplicate path records", () => {
    expect(() => canonicalJson({ value: undefined })).toThrow("undefined");
    expect(() => canonicalJson(Number.NaN)).toThrow("safe integers");
    const file = {
      pathBase64: Buffer.from("same").toString("base64"),
      oldBlob: "0".repeat(40),
      newBlob: "1".repeat(40),
      oldMode: "100644",
      newMode: "100644",
      status: "M" as const
    };
    expect(() => canonicalizeFiles([file, file])).toThrow("duplicate path");
  });
});
