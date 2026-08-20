import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleDot,
  CircleCheck,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  PackageCheck,
  Play,
  Power,
  Square,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  captureArtifact,
  decideApproval,
  getIdeUrl,
  getWorkspace,
  provisionWorkspace,
  requestApproval,
  runTask,
  setWorkspaceState,
  startGitOperation,
  validateArtifact,
  type ReviewSnapshot,
  type ApprovalRequest,
  type GitOperation,
  type Workspace,
} from "./api";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input, Textarea } from "./components/ui/input";

export function App(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [taskResult, setTaskResult] = useState<string>();
  const [review, setReview] = useState<ReviewSnapshot>();
  const [approval, setApproval] = useState<ApprovalRequest>();
  const [gitOperation, setGitOperation] = useState<GitOperation>();
  const ownerUserId = useMemo(() => getOwnerId(), []);

  const workspaceQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 4_000,
  });
  const provision = useMutation({
    mutationFn: () => provisionWorkspace(repositoryUrl, defaultBranch, ownerUserId),
    onSuccess: (workspace) => {
      setWorkspaceId(workspace.id);
      queryClient.setQueryData(["workspace", workspace.id], workspace);
    },
  });
  const transition = useMutation({
    mutationFn: (state: Workspace["desiredState"]) =>
      setWorkspaceState(workspaceId!, state),
    onSuccess: (workspace) =>
      queryClient.setQueryData(["workspace", workspace.id], workspace),
  });
  const task = useMutation({
    mutationFn: () => runTask(workspaceId!, prompt, `web:${ownerUserId}`),
    onSuccess: (result) => {
      setTaskResult(result.result ?? "Task completed without a final message.");
      setPrompt("");
      void workspaceQuery.refetch();
    },
  });
  const validation = useMutation({
    mutationFn: async () => {
      const artifact = await captureArtifact(workspaceId!);
      return validateArtifact(artifact.id);
    },
    onSuccess: (nextReview) => {
      setReview(nextReview);
      setApproval(undefined);
      setGitOperation(undefined);
    },
  });
  const approvalRequest = useMutation({
    mutationFn: () => requestApproval(review!.id, ownerUserId),
    onSuccess: setApproval,
  });
  const approvalDecision = useMutation({
    mutationFn: (decision: "APPROVE" | "DENY") =>
      decideApproval(approval!.id, decision, ownerUserId),
    onSuccess: setApproval,
  });
  const operationStart = useMutation({
    mutationFn: () => startGitOperation(approval!.id),
    onSuccess: setGitOperation,
  });
  const openIde = async (): Promise<void> => {
    const { url } = await getIdeUrl(workspaceId!);
    if (!url) throw new Error("IDE is not available");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const workspace = workspaceQuery.data;
  const error =
    provision.error ??
    transition.error ??
    task.error ??
    validation.error ??
    approvalRequest.error ??
    approvalDecision.error ??
    operationStart.error ??
    workspaceQuery.error;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#164e63_0,transparent_34%),linear-gradient(145deg,#020617_0%,#0f172a_55%,#07131c_100%)] px-5 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              <TerminalSquare size={15} /> Tier 1 control plane
            </div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Remote Agent Devbox</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Provision an isolated workspace, send a focused task to Codex, and inspect the result in a local web IDE.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">
            <CircleDot size={13} /> Secure Personal / Small Team
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <SectionTitle icon={<GitBranch size={18} />} title="Provision workspace" />
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                provision.mutate();
              }}
            >
              <Field label="Public HTTPS repository">
                <Input
                  required
                  type="url"
                  placeholder="https://github.com/owner/repository.git"
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                />
              </Field>
              <Field label="Default branch">
                <Input
                  required
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                />
              </Field>
              <Button className="w-full" disabled={provision.isPending}>
                {provision.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}
                Create and start
              </Button>
            </form>
          </Card>

          <Card className="min-h-80">
            <SectionTitle icon={<Power size={18} />} title="Workspace state" />
            {workspace ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Metric label="Desired" value={workspace.desiredState} />
                  <Metric label="Observed" value={workspace.observedState} accent />
                  <Metric label="Version" value={String(workspace.stateVersion)} />
                  <Metric label="Branch" value={workspace.branchName} />
                </div>
                <p className="break-all rounded-lg bg-black/20 p-3 font-mono text-xs text-slate-400">{workspace.id}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void openIde()} disabled={workspace.observedState !== "READY"}>
                    <ExternalLink size={14} /> Open IDE
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => transition.mutate("RUNNING")}>
                    <Play size={14} /> Start
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => transition.mutate("STOPPED")}>
                    <Square size={14} /> Stop
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => transition.mutate("DESTROYED")}>
                    <Trash2 size={14} /> Destroy
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState />
            )}
          </Card>

          <Card className="lg:col-span-2">
            <SectionTitle icon={<TerminalSquare size={18} />} title="Agent task" />
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <Textarea
                  placeholder="Describe the change, constraints, and expected verification…"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <Button
                  disabled={!workspace || workspace.observedState !== "READY" || !prompt || task.isPending}
                  onClick={() => task.mutate()}
                >
                  {task.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}
                  Run in workspace
                </Button>
              </div>
              <pre className="min-h-36 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/30 p-4 text-xs leading-6 text-slate-300">
                {taskResult ?? "The agent's final message will appear here."}
              </pre>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <SectionTitle icon={<ShieldCheck size={18} />} title="Immutable review" />
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Capture committed workspace state, validate it without network access, and bind the result to CRF-1.
                </p>
              </div>
              <Button
                disabled={
                  !workspace || workspace.observedState !== "READY" || validation.isPending
                }
                onClick={() => validation.mutate()}
              >
                {validation.isPending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <PackageCheck size={16} />
                )}
                Capture and validate
              </Button>
            </div>
            {review ? (
              <ReviewSummary
                review={review}
                approval={approval}
                operation={gitOperation}
                isPending={
                  approvalRequest.isPending ||
                  approvalDecision.isPending ||
                  operationStart.isPending
                }
                onRequest={() => approvalRequest.mutate()}
                onDecision={(decision) => approvalDecision.mutate(decision)}
                onStartOperation={() => operationStart.mutate()}
              />
            ) : null}
          </Card>
        </div>
        {error ? <p className="mt-5 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error.message}</p> : null}
      </div>
    </main>
  );
}

function ReviewSummary({
  review,
  approval,
  operation,
  isPending,
  onRequest,
  onDecision,
  onStartOperation,
}: {
  review: ReviewSnapshot;
  approval: ApprovalRequest | undefined;
  operation: GitOperation | undefined;
  isPending: boolean;
  onRequest: () => void;
  onDecision: (decision: "APPROVE" | "DENY") => void;
  onStartOperation: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-5 space-y-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="CRF" value="CRF-1" accent />
        <Metric label="Tier" value={String(review.deploymentTier)} />
        <Metric label="Security epoch" value={String(review.securityEpoch)} />
        <Metric label="Changed files" value={String(review.structuralManifest.files.length)} />
      </div>
      <Digest label="Review digest" value={review.reviewDigest} />
      <Digest label="Artifact digest" value={review.artifactDigest} />
      <Digest label="Validator profile" value={review.validatorProfileDigest} />
      <div className="grid gap-3 md:grid-cols-3">
        <Commit label="Base" value={review.structuralManifest.baseCommit} />
        <Commit label="Target" value={review.structuralManifest.targetCommit} />
        <Commit label="Tree" value={review.structuralManifest.targetTree} />
      </div>
      {review.structuralManifest.files.length > 0 ? (
        <div className="max-h-44 overflow-auto rounded-lg bg-black/20 p-3 font-mono text-xs text-slate-300">
          {review.structuralManifest.files.map((file) => (
            <div className="flex gap-3 py-1" key={`${file.status}:${file.pathBase64}`}>
              <span className="w-4 text-cyan-300">{file.status}</span>
              <span className="break-all">{displayPath(file.pathBase64)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col justify-between gap-3 border-t border-white/5 pt-4 md:flex-row md:items-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Human approval</div>
          <div className="mt-1 text-xs text-slate-300">
            {approval
              ? `${approval.status}${approval.staleReason ? ` - ${approval.staleReason}` : ""}`
              : "No approval request"}
          </div>
          {approval ? (
            <div className="mt-1 text-[11px] text-slate-500">
              Expires {new Date(approval.expiresAt).toLocaleString()}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          {!approval || approval.status === "DENIED" || approval.status === "STALE" ? (
            <Button size="sm" disabled={isPending} onClick={onRequest}>
              {isPending ? <LoaderCircle className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
              {approval ? "Request again" : "Request approval"}
            </Button>
          ) : approval.status === "PENDING" ? (
            <>
              <Button size="sm" disabled={isPending} onClick={() => onDecision("APPROVE")}>
                <CircleCheck size={14} /> Approve reviewed digest
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() => onDecision("DENY")}
              >
                <XCircle size={14} /> Deny
              </Button>
            </>
          ) : approval.status === "APPROVED" && !operation ? (
            <Button size="sm" disabled={isPending} onClick={onStartOperation}>
              {isPending ? <LoaderCircle className="animate-spin" size={14} /> : <GitBranch size={14} />}
              Final revalidation
            </Button>
          ) : null}
        </div>
      </div>
      {operation ? (
        <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Git operation: {operation.state}</span>
            <span className="font-mono text-slate-500">{operation.branchName}</span>
          </div>
          {operation.staleReason || operation.errorCode ? (
            <div className="mt-2 text-rose-300">
              {operation.staleReason ?? operation.errorCode}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Digest({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 break-all font-mono text-xs text-slate-300">{value}</div>
    </div>
  );
}

function Commit({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-slate-300" title={value}>
        {value.slice(0, 12)}
      </div>
    </div>
  );
}

function displayPath(pathBase64: string): string {
  const bytes = Uint8Array.from(atob(pathBase64), (character) => character.charCodeAt(0));
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return decoded.includes("\uFFFD") ? `base64:${pathBase64}` : decoded;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }): React.JSX.Element {
  return <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">{icon}{title}</h2>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <label className="block space-y-2 text-xs font-medium text-slate-400"><span>{label}</span>{children}</label>;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3"><div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div><div className={`mt-2 truncate text-xs font-semibold ${accent ? "text-cyan-300" : "text-slate-200"}`}>{value}</div></div>;
}

function EmptyState(): React.JSX.Element {
  return <div className="mt-14 text-center text-sm text-slate-500"><LoaderCircle className="mx-auto mb-3 opacity-30" size={28} />No active workspace in this browser session.</div>;
}

function getOwnerId(): string {
  const key = "rad-owner-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
