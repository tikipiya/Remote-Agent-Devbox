import { randomUUID } from "node:crypto";

import type { AuditEventRepository } from "@rad/audit-events";
import type {
  IdeAccessService,
  IssuedIdeAccessCode,
  RedeemedIdeAccessSession,
  ResolvedIdeAccessSession,
} from "@rad/ide-access";

export interface ControlIdeAccessService {
  issue(workspaceId: string, requestedBy: string): Promise<IssuedIdeAccessCode>;
  redeem(code: string): Promise<RedeemedIdeAccessSession>;
  resolve(sessionToken: string): Promise<ResolvedIdeAccessSession>;
}

export class AuditedIdeAccessService implements ControlIdeAccessService {
  public constructor(
    private readonly access: Pick<IdeAccessService, "issue" | "redeem" | "resolve">,
    private readonly audit: AuditEventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async issue(
    workspaceId: string,
    requestedBy: string,
  ): Promise<IssuedIdeAccessCode> {
    const access = await this.access.issue(workspaceId);
    await this.audit.append({
      id: randomUUID(),
      eventType: "IDE_ACCESS_CODE_ISSUED",
      severity: "INFO",
      actorId: requestedBy,
      subjectType: "workspace",
      subjectId: workspaceId,
      securityEpoch: access.securityEpoch,
      deploymentTier: access.deploymentTier,
      details: {
        expiresAt: access.expiresAt.toISOString(),
        workspaceStateVersion: access.workspaceStateVersion,
      },
      occurredAt: this.now(),
    });
    return access;
  }

  public async redeem(code: string): Promise<RedeemedIdeAccessSession> {
    const session = await this.access.redeem(code);
    await this.audit.append({
      id: randomUUID(),
      eventType: "IDE_ACCESS_CODE_REDEEMED",
      severity: "INFO",
      actorId: null,
      subjectType: "workspace",
      subjectId: session.workspaceId,
      securityEpoch: session.securityEpoch,
      deploymentTier: session.deploymentTier,
      details: {
        expiresAt: session.expiresAt.toISOString(),
        workspaceStateVersion: session.workspaceStateVersion,
      },
      occurredAt: this.now(),
    });
    return session;
  }

  public resolve(sessionToken: string): Promise<ResolvedIdeAccessSession> {
    return this.access.resolve(sessionToken);
  }
}
