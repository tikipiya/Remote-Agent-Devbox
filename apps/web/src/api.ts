export interface Workspace {
  id: string;
  desiredState: "RUNNING" | "SUSPENDED" | "STOPPED" | "DESTROYED";
  observedState: string;
  branchName: string;
  stateVersion: number;
  expiresAt: string;
  lastError: string | null;
}

export interface AgentTask {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  result: string | null;
  error: string | null;
}

export interface GitArtifact {
  id: string;
  workspaceId: string;
  repositoryId: string;
  artifactDigest: string;
  sizeBytes: number;
  status: "STAGED" | "VALIDATED" | "REJECTED";
}

export interface ReviewSnapshot {
  id: string;
  artifactId: string;
  reviewDigest: string;
  artifactDigest: string;
  validatorProfileDigest: string;
  validatorProfile: {
    imageDigest: string;
    gitBinaryDigest: string;
    policyDigest: string;
  };
  securityEpoch: number;
  deploymentTier: number;
  structuralManifest: {
    baseCommit: string;
    targetCommit: string;
    targetTree: string;
    files: Array<{
      pathBase64: string;
      status: "A" | "D" | "M" | "T";
      oldMode: string;
      newMode: string;
      oldBlob: string;
      newBlob: string;
    }>;
  };
}

export interface SecurityStatus {
  deploymentTier: number;
  securityEpoch: number;
  securityPostureHash: string;
  maintenanceMode: boolean;
  maintenanceReason: string | null;
  maintenanceStartedAt: string | null;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  sequence: number;
  eventType: string;
  severity: "INFO" | "WARNING" | "HIGH" | "CRITICAL";
  actorId: string | null;
  subjectType: string;
  subjectId: string | null;
  securityEpoch: number;
  deploymentTier: number;
  details: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface ApprovalRequest {
  id: string;
  reviewSnapshotId: string;
  operationType: "CREATE_PULL_REQUEST";
  reviewDigest: string;
  validatorProfileDigest: string;
  securityEpoch: number;
  status: "PENDING" | "APPROVED" | "DENIED" | "STALE";
  staleReason: string | null;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface GitOperation {
  id: string;
  approvalId: string;
  branchName: string;
  targetCommit: string;
  expectedRemoteHead: string | null;
  reviewDigest: string;
  validatorProfileDigest: string;
  securityEpoch: number;
  state:
    | "PENDING"
    | "VALIDATING"
    | "WAITING_CREDENTIAL"
    | "PUSHING"
    | "SUCCEEDED"
    | "FAILED"
    | "CONFLICT"
    | "CANCELLED"
    | "STALE";
  staleReason: string | null;
  errorCode: string | null;
  pullRequestUrl: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return body;
}

export async function provisionWorkspace(
  repositoryUrl: string,
  defaultBranch: string,
  ownerUserId: string,
): Promise<Workspace> {
  const repository = await request<{ id: string }>("/api/repositories", {
    method: "POST",
    body: JSON.stringify({ remoteUrl: repositoryUrl, defaultBranch }),
  });
  return request<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ repositoryId: repository.id, ownerUserId }),
  });
}

export const getWorkspace = (id: string): Promise<Workspace> =>
  request(`/api/workspaces/${id}`);

export const createIdeAccess = (
  id: string,
  requestedBy: string,
): Promise<{ url: string; expiresAt: string }> =>
  request(`/api/workspaces/${id}/ide-access`, {
    method: "POST",
    body: JSON.stringify({ requestedBy }),
  });

export const setWorkspaceState = (
  id: string,
  state: Workspace["desiredState"],
): Promise<Workspace> =>
  request(`/api/workspaces/${id}/state`, {
    method: "PATCH",
    body: JSON.stringify({ state }),
  });

export const runTask = (
  workspaceId: string,
  prompt: string,
  requestedBy: string,
): Promise<AgentTask> =>
  request(`/api/workspaces/${workspaceId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ prompt, requestedBy }),
  });

export const captureArtifact = (workspaceId: string): Promise<GitArtifact> =>
  request(`/api/workspaces/${workspaceId}/artifacts`, { method: "POST" });

export const validateArtifact = (artifactId: string): Promise<ReviewSnapshot> =>
  request(`/api/artifacts/${artifactId}/validate`, { method: "POST" });

export const requestApproval = (
  reviewSnapshotId: string,
  requestedBy: string,
): Promise<ApprovalRequest> =>
  request(`/api/reviews/${reviewSnapshotId}/approvals`, {
    method: "POST",
    body: JSON.stringify({ requestedBy }),
  });

export const decideApproval = (
  approvalId: string,
  decision: "APPROVE" | "DENY",
  decidedBy: string,
): Promise<ApprovalRequest> =>
  request(`/api/approvals/${approvalId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, decidedBy }),
  });

export const startGitOperation = (approvalId: string): Promise<GitOperation> =>
  request(`/api/approvals/${approvalId}/git-operations`, { method: "POST" });

export const getSecurityStatus = (): Promise<SecurityStatus> =>
  request("/api/security/status");

export const listAuditEvents = (limit = 20): Promise<AuditEvent[]> =>
  request(`/api/audit-events?limit=${limit}`);
