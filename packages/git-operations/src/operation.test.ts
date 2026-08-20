import { describe, expect, it } from "vitest";

import { canTransitionGitOperation } from "./operation.js";

describe("Git operation state machine", () => {
  it("allows only forward security-sensitive transitions", () => {
    expect(canTransitionGitOperation("PENDING", "VALIDATING")).toBe(true);
    expect(canTransitionGitOperation("VALIDATING", "WAITING_CREDENTIAL")).toBe(true);
    expect(canTransitionGitOperation("WAITING_CREDENTIAL", "PUSHING")).toBe(true);
    expect(canTransitionGitOperation("PUSHING", "SUCCEEDED")).toBe(true);
    expect(canTransitionGitOperation("SUCCEEDED", "PUSHING")).toBe(false);
    expect(canTransitionGitOperation("FAILED", "PENDING")).toBe(false);
  });
});
