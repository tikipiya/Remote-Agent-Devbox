import { describe, expect, it } from "vitest";

import type { AuditEvent, AuditEventRepository, NewAuditEvent } from "@rad/audit-events";
import type { InstanceSecurityMetadata } from "@rad/workspace-state";

import {
  SecurityMigrationService,
  type SecurityMigrationRepository,
} from "./security-migration.js";

const now = new Date("2026-01-01T00:00:00Z");
const actor = "10000000-0000-4000-8000-000000000001";
const original: InstanceSecurityMetadata = {
  deploymentTier: 2,
  securityEpoch: 42,
  securityPostureHash: `sha256:${"a".repeat(64)}`,
  maintenanceMode: false,
  maintenanceReason: null,
  maintenanceStartedAt: null,
  updatedAt: now,
};

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

describe("SecurityMigrationService", () => {
  it("requires explicit epoch/tier confirmation and leaves no silent transition", async () => {
    const { service, migrations } = fixture();
    await expect(service.migrate(input("wrong"))).rejects.toThrow("Confirmation must exactly");
    expect(migrations.calls).toBe(0);
  });

  it("enters maintenance, commits once, audits, and reconciles", async () => {
    const { service, migrations, audit, reconciled } = fixture();
    const result = await service.migrate(input("MIGRATE EPOCH 42 TIER 2->1"));
    expect(result.metadata.securityEpoch).toBe(43);
    expect(migrations.calls).toBe(1);
    expect(audit.events.map((event) => event.eventType)).toEqual([
      "SECURITY_POSTURE_MIGRATION_REQUESTED",
      "SECURITY_POSTURE_MIGRATION_STARTED",
    ]);
    expect(reconciled.value).toBe(true);
  });

  it("keeps maintenance active and records a critical failure", async () => {
    const { service, migrations, audit, metadata } = fixture();
    migrations.fail = true;
    await expect(service.migrate(input("MIGRATE EPOCH 42 TIER 2->1"))).rejects.toThrow(
      "blocked",
    );
    expect(metadata.current.maintenanceMode).toBe(true);
    expect(audit.events.at(-1)?.eventType).toBe("SECURITY_POSTURE_MIGRATION_FAILED");
    expect(audit.events.at(-1)?.severity).toBe("CRITICAL");
  });
});

function input(confirmation: string) {
  return {
    targetTier: 1,
    targetPostureHash: `sha256:${"b".repeat(64)}` as const,
    initiatedBy: actor,
    reason: "operator-requested downgrade",
    confirmation,
  };
}

function fixture() {
  const metadata = {
    current: { ...original },
    getSecurityMetadata: async () => metadata.current,
    synchronizeSecurityMetadata: async () => metadata.current,
    enterMaintenanceMode: async (reason: string, startedAt: Date) => {
      metadata.current = {
        ...metadata.current,
        maintenanceMode: true,
        maintenanceReason: reason,
        maintenanceStartedAt: startedAt,
      };
      return metadata.current;
    },
    exitMaintenanceMode: async () => metadata.current,
  };
  const migrations: SecurityMigrationRepository & { calls: number; fail: boolean } = {
    calls: 0,
    fail: false,
    async commit() {
      this.calls += 1;
      if (this.fail) throw new Error("blocked");
      return {
        metadata: {
          ...metadata.current,
          deploymentTier: 1,
          securityEpoch: 43,
          securityPostureHash: `sha256:${"b".repeat(64)}`,
          maintenanceMode: false,
          maintenanceReason: null,
          maintenanceStartedAt: null,
        },
        staleApprovals: 2,
        cancelledOperations: 1,
        invalidatedLeases: 1,
        stoppedWorkspaces: 1,
      };
    },
  };
  const audit = new MemoryAudit();
  const reconciled = { value: false };
  return {
    service: new SecurityMigrationService(metadata, migrations, audit, {
      reconcileAll: async () => {
        reconciled.value = true;
      },
    }, () => now),
    migrations,
    audit,
    metadata,
    reconciled,
  };
}
