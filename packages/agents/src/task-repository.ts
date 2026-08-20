import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { RadError } from "@rad/shared";

import type { AgentTask, TaskStatus } from "./task.js";

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull(),
    result: text("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tasks_workspace_idx").on(table.workspaceId, table.createdAt),
    check(
      "agent_tasks_status_check",
      sql`${table.status} IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')`,
    ),
  ],
);

export interface NewAgentTask {
  id: string;
  workspaceId: string;
  requestedBy: string;
  prompt: string;
}

export interface AgentTaskRepository {
  create(input: NewAgentTask): Promise<AgentTask>;
  get(id: string): Promise<AgentTask | undefined>;
  markRunning(id: string): Promise<AgentTask>;
  markCompleted(id: string, result: string): Promise<AgentTask>;
  markFailed(id: string, error: string): Promise<AgentTask>;
}

export class PostgresAgentTaskRepository implements AgentTaskRepository {
  public constructor(private readonly db: NodePgDatabase) {}

  public async create(input: NewAgentTask): Promise<AgentTask> {
    const [record] = await this.db
      .insert(agentTasks)
      .values({ ...input, status: "PENDING" })
      .returning();
    return requireTask(record);
  }

  public async get(id: string): Promise<AgentTask | undefined> {
    const [record] = await this.db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, id))
      .limit(1);
    return record ? asTask(record) : undefined;
  }

  public markRunning(id: string): Promise<AgentTask> {
    return this.transition(id, "PENDING", "RUNNING", {
      startedAt: new Date(),
      error: null,
    });
  }

  public markCompleted(id: string, result: string): Promise<AgentTask> {
    return this.transition(id, "RUNNING", "COMPLETED", {
      result,
      completedAt: new Date(),
      error: null,
    });
  }

  public markFailed(id: string, error: string): Promise<AgentTask> {
    return this.transition(id, "RUNNING", "FAILED", {
      error,
      completedAt: new Date(),
    });
  }

  private async transition(
    id: string,
    expected: TaskStatus,
    status: TaskStatus,
    values: Partial<typeof agentTasks.$inferInsert>,
  ): Promise<AgentTask> {
    const [record] = await this.db
      .update(agentTasks)
      .set({ ...values, status })
      .where(and(eq(agentTasks.id, id), eq(agentTasks.status, expected)))
      .returning();
    if (!record) {
      throw new RadError(
        "TASK_STATE_CONFLICT",
        `Task ${id} is no longer ${expected}`,
      );
    }
    return asTask(record);
  }
}

function requireTask(record: typeof agentTasks.$inferSelect | undefined): AgentTask {
  if (!record) throw new RadError("TASK_CREATE_FAILED", "Task was not created");
  return asTask(record);
}

function asTask(record: typeof agentTasks.$inferSelect): AgentTask {
  return { ...record, status: record.status as TaskStatus };
}

