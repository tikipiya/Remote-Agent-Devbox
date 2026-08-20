import { describe, expect, it } from "vitest";

import {
  auditDetailsSchema,
  auditEventTypeSchema,
  auditSeveritySchema,
} from "./event.js";

describe("audit event domain", () => {
  it("accepts structured secret-free audit data", () => {
    expect(auditEventTypeSchema.parse("SECURITY_TIER_DOWNGRADE_COMPLETED")).toBe(
      "SECURITY_TIER_DOWNGRADE_COMPLETED",
    );
    expect(auditSeveritySchema.parse("HIGH")).toBe("HIGH");
    expect(auditDetailsSchema.parse({ fromTier: 2, toTier: 1, acknowledged: true })).toEqual({
      fromTier: 2,
      toTier: 1,
      acknowledged: true,
    });
  });

  it("rejects secret-bearing keys, nesting, and unbounded event names", () => {
    expect(auditDetailsSchema.safeParse({ accessToken: "nope" }).success).toBe(false);
    expect(auditDetailsSchema.safeParse({ nested: { value: true } }).success).toBe(false);
    expect(auditEventTypeSchema.safeParse("tier changed").success).toBe(false);
  });
});
