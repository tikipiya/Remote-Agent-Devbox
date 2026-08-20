import { describe, expect, it } from "vitest";

import { outboxCommandTypeSchema, outboxPayloadSchema } from "./command.js";

describe("outbox command domain", () => {
  it("contains only workspace intent without secret-bearing extension fields", () => {
    expect(outboxPayloadSchema.parse({ desiredState: "STOPPED" })).toEqual({
      desiredState: "STOPPED",
    });
    expect(
      outboxPayloadSchema.safeParse({ desiredState: "RUNNING", credential: "secret" }).success,
    ).toBe(false);
    expect(outboxCommandTypeSchema.parse("DESTROY")).toBe("DESTROY");
  });
});
