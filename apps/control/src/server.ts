import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import {
  RadError,
  desiredWorkspaceStateSchema,
  gitRefNameSchema,
  type RuntimeConfig,
} from "@rad/shared";
import type {
  InstanceMetadataRepository,
  WorkspaceCoordinator,
  WorkspaceReconciler,
  WorkspaceRepository,
} from "@rad/workspace-state";
import type { AuditEventRepository } from "@rad/audit-events";

import type { DockerSandboxSupervisor } from "./workspace/docker-supervisor.js";
import type { TaskService } from "./tasks/task-service.js";
import type { ArtifactService } from "./artifacts/artifact-service.js";
import type { ReviewService } from "./validation/review-service.js";
import type { ApprovalService } from "./approvals/approval-service.js";
import type { GitOperationService } from "./git/git-operation-service.js";
import type { OperationalGuard } from "./security/maintenance-guard.js";

export interface ControlServices {
  config: RuntimeConfig;
  repository: WorkspaceRepository;
  coordinator: Pick<WorkspaceCoordinator, "requestState">;
  reconciler: Pick<WorkspaceReconciler, "reconcile" | "reconcileAll">;
  supervisor: Pick<DockerSandboxSupervisor, "getIdeUrl">;
  taskService: Pick<TaskService, "run" | "get">;
  artifactService: Pick<ArtifactService, "capture" | "get">;
  reviewService: Pick<ReviewService, "validateArtifact" | "get">;
  approvalService: Pick<ApprovalService, "request" | "get" | "approve" | "deny">;
  gitOperationService: Pick<GitOperationService, "start" | "get">;
  operationalGuard: OperationalGuard;
  securityMetadata: Pick<InstanceMetadataRepository, "getSecurityMetadata">;
  auditEvents: Pick<AuditEventRepository, "listRecent">;
}

const repositoryBodySchema = z.object({
  remoteUrl: z.url().refine((url) => url.startsWith("https://"), {
    message: "Only HTTPS repository URLs are accepted",
  }),
  defaultBranch: gitRefNameSchema.default("main"),
});

const workspaceBodySchema = z.object({
  ownerUserId: z.uuid(),
  repositoryId: z.uuid(),
});

const stateBodySchema = z.object({ state: desiredWorkspaceStateSchema });
const taskBodySchema = z.object({
  prompt: z.string().min(1).max(64 * 1024),
  requestedBy: z.string().min(1).max(255),
});
const idParamsSchema = z.object({ id: z.uuid() });
const approvalRequestBodySchema = z.object({ requestedBy: z.uuid() }).strict();
const approvalDecisionBodySchema = z
  .object({ decision: z.enum(["APPROVE", "DENY"]), decidedBy: z.uuid() })
  .strict();
const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function createControlServer(services: ControlServices): FastifyInstance {
  const server = Fastify({
    logger: services.config.NODE_ENV !== "test",
    bodyLimit: 64 * 1024,
    requestTimeout: Math.max(30_000, services.config.RAD_VALIDATOR_TIMEOUT_MS + 5_000),
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.status(400).send({
        error: "INVALID_REQUEST",
        details: z.treeifyError(error),
      });
      return;
    }
    if (error instanceof RadError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : 409;
      void reply.status(status).send({ error: error.code, message: error.message });
      return;
    }
    server.log.error(error);
    void reply.status(500).send({ error: "INTERNAL_ERROR" });
  });

  server.get("/health", async () => {
    const metadata = await services.securityMetadata.getSecurityMetadata();
    return {
      status: metadata?.maintenanceMode ? "maintenance" : "ok",
      tier: metadata?.deploymentTier ?? null,
      securityEpoch: metadata?.securityEpoch ?? null,
    };
  });

  server.get("/api/security/status", async () => {
    const metadata = await services.securityMetadata.getSecurityMetadata();
    if (!metadata) {
      throw new RadError("SECURITY_CONTEXT_MISSING", "Instance security metadata is missing");
    }
    return metadata;
  });

  server.get("/api/audit-events", async (request) => {
    const { limit } = auditQuerySchema.parse(request.query);
    return services.auditEvents.listRecent(limit);
  });

  const webRoot = resolve("apps/web/dist");
  if (existsSync(`${webRoot}/index.html`)) {
    void server.register(fastifyStatic, { root: webRoot, wildcard: true });
  }

  server.post("/api/repositories", async (request, reply) => {
    await services.operationalGuard.assertAvailable("Repository creation");
    const input = repositoryBodySchema.parse(request.body);
    const repository = await services.repository.createRepository({
      id: randomUUID(),
      ...input,
    });
    return reply.status(201).send(repository);
  });

  server.post("/api/workspaces", async (request, reply) => {
    await services.operationalGuard.assertAvailable("Workspace creation");
    const input = workspaceBodySchema.parse(request.body);
    const id = randomUUID();
    const workspace = await services.repository.createWorkspace({
      id,
      ...input,
      branchName: `agent/${id}`,
      expiresAt: new Date(Date.now() + services.config.RAD_WORKSPACE_TTL_SECONDS * 1000),
    });
    const reconciled = await services.reconciler.reconcile(workspace.id);
    return reply.status(201).send(reconciled);
  });

  server.get("/api/workspaces/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const workspace = await services.repository.getWorkspace(id);
    if (!workspace) throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${id} not found`);
    return workspace;
  });

  server.get("/api/workspaces/:id/ide", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const workspace = await services.repository.getWorkspace(id);
    if (!workspace) throw new RadError("WORKSPACE_NOT_FOUND", `Workspace ${id} not found`);
    return { url: await services.supervisor.getIdeUrl(workspace) };
  });

  server.patch("/api/workspaces/:id/state", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { state } = stateBodySchema.parse(request.body);
    if (state === "RUNNING") {
      await services.operationalGuard.assertAvailable("Workspace start");
    }
    return services.coordinator.requestState(id, state);
  });

  server.post("/api/workspaces/:id/tasks", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = taskBodySchema.parse(request.body);
    const task = await services.taskService.run(id, input.prompt, input.requestedBy);
    return reply.status(201).send(task);
  });

  server.get("/api/tasks/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const task = await services.taskService.get(id);
    if (!task) throw new RadError("TASK_NOT_FOUND", `Task ${id} not found`);
    return task;
  });

  server.post("/api/workspaces/:id/artifacts", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const artifact = await services.artifactService.capture(id);
    return reply.status(201).send(artifact);
  });

  server.get("/api/artifacts/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const artifact = await services.artifactService.get(id);
    if (!artifact) {
      throw new RadError("ARTIFACT_NOT_FOUND", `Artifact ${id} not found`);
    }
    return artifact;
  });

  server.post("/api/artifacts/:id/validate", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return services.reviewService.validateArtifact(id);
  });

  server.get("/api/reviews/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const review = await services.reviewService.get(id);
    if (!review) {
      throw new RadError("REVIEW_NOT_FOUND", `Review ${id} not found`);
    }
    return review;
  });

  server.post("/api/reviews/:id/approvals", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { requestedBy } = approvalRequestBodySchema.parse(request.body);
    const approval = await services.approvalService.request(id, requestedBy);
    return reply.status(201).send(approval);
  });

  server.get("/api/approvals/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const approval = await services.approvalService.get(id);
    if (!approval) {
      throw new RadError("APPROVAL_NOT_FOUND", `Approval ${id} not found`);
    }
    return approval;
  });

  server.post("/api/approvals/:id/decision", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = approvalDecisionBodySchema.parse(request.body);
    return input.decision === "APPROVE"
      ? services.approvalService.approve(id, input.decidedBy)
      : services.approvalService.deny(id, input.decidedBy);
  });

  server.post("/api/approvals/:id/git-operations", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const operation = await services.gitOperationService.start(id);
    return reply.status(201).send(operation);
  });

  server.get("/api/git-operations/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const operation = await services.gitOperationService.get(id);
    if (!operation) {
      throw new RadError("GIT_OPERATION_NOT_FOUND", `Git operation ${id} not found`);
    }
    return operation;
  });

  return server;
}
