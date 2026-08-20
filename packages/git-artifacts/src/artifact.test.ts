import { describe, expect, it } from "vitest";

import { sha256DigestSchema } from "./artifact.js";

describe("sha256DigestSchema", () => {
  it("accepts only canonical lowercase SHA-256 identities", () => {
    expect(
      sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`),
    ).toBe(`sha256:${"a".repeat(64)}`);
    expect(() => sha256DigestSchema.parse(`sha256:${"A".repeat(64)}`)).toThrow();
    expect(() => sha256DigestSchema.parse("sha256:../artifact")).toThrow();
  });
});
