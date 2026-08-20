import { describe, expect, it } from "vitest";

import type { AuditEvent, AuditEventRepository, NewAuditEvent } from "@rad/audit-events";

import { AuditedIdeAccessService } from "./ide-access-service.js";

const now = new Date("2026-01-01T00:00:00Z");
const workspaceId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000001";

class MemoryAudit implements AuditEventRepository {
  public events: NewAuditEvent[] = [];
  public async append(input: NewAuditEvent): Promise<AuditEvent> {
    this.events.push(input);
    return { ...input, sequence: this.events.length };
  }
  public async listRecent(): Promise<AuditEvent[]> {
    return [];
  }
}

describe("AuditedIdeAccessService", () => {
  it("audits issuance and redemption without recording authority bytes", async () => {
    const audit = new MemoryAudit();
    const access = {
      issue: async () => ({
        code: "a".repeat(43),
        deploymentTier: 1,
        expiresAt: new Date("2026-01-01T00:01:00Z"),
        securityEpoch: 9,
        workspaceStateVersion: 4,
        workspaceId,
      }),
      redeem: async () => ({
        sessionToken: "b".repeat(43),
        deploymentTier: 1,
        expiresAt: new Date("2026-01-01T01:00:00Z"),
        securityEpoch: 9,
        workspaceStateVersion: 4,
        workspaceId,
      }),
      resolve: async () => ({ expiresAt: now, workspaceId }),
    };
    const service = new AuditedIdeAccessService(access, audit, () => now);

    await service.issue(workspaceId, actorId);
    await service.redeem("a".repeat(43));

    expect(audit.events.map((event) => event.eventType)).toEqual([
      "IDE_ACCESS_CODE_ISSUED",
      "IDE_ACCESS_CODE_REDEEMED",
    ]);
    expect(audit.events[0]?.actorId).toBe(actorId);
    expect(JSON.stringify(audit.events)).not.toContain("a".repeat(43));
    expect(JSON.stringify(audit.events)).not.toContain("b".repeat(43));
  });
});
