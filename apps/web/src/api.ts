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

export const getIdeUrl = (id: string): Promise<{ url?: string }> =>
  request(`/api/workspaces/${id}/ide`);

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

