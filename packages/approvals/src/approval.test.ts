import { describe, expect, it } from "vitest";

import {
  approvalOperationTypeSchema,
  approvalStaleReasonSchema,
  approvalStatusSchema,
} from "./approval.js";

describe("approval domain", () => {
  it("accepts only the frozen operation and lifecycle values", () => {
    expect(approvalOperationTypeSchema.parse("CREATE_PULL_REQUEST")).toBe(
      "CREATE_PULL_REQUEST",
    );
    expect(approvalStatusSchema.options).toEqual(["PENDING", "APPROVED", "DENIED", "STALE"]);
    expect(approvalStaleReasonSchema.safeParse("APPROVAL_EXPIRED").success).toBe(true);
    expect(approvalOperationTypeSchema.safeParse("PUSH_DEFAULT_BRANCH").success).toBe(false);
  });
});
