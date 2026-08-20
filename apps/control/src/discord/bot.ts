import { createHash, randomUUID } from "node:crypto";

import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { z } from "zod";

import {
  gitRefNameSchema,
  type RuntimeConfig,
} from "@rad/shared";
import type {
  WorkspaceReconciler,
  WorkspaceRepository,
} from "@rad/workspace-state";

import type { TaskService } from "../tasks/task-service.js";

interface DiscordBotDependencies {
  config: RuntimeConfig;
  repository: WorkspaceRepository;
  reconciler: Pick<WorkspaceReconciler, "reconcile">;
  taskService: Pick<TaskService, "run">;
}

const command = new SlashCommandBuilder()
  .setName("rad-task")
  .setDescription("Run a coding task in an isolated Remote Agent Devbox workspace")
  .addStringOption((option) =>
    option
      .setName("repository")
      .setDescription("Public HTTPS Git repository URL")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("task").setDescription("Task for Codex").setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("branch").setDescription("Repository default branch"),
  );

const commandInputSchema = z.object({
  repository: z.url().refine((url) => url.startsWith("https://")),
  task: z.string().min(1).max(4_000),
  branch: gitRefNameSchema,
});

export async function startDiscordBot(
  dependencies: DiscordBotDependencies,
): Promise<Client | undefined> {
  const token = dependencies.config.RAD_DISCORD_TOKEN;
  if (!token) return undefined;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once("ready", async () => {
    const commands = [command.toJSON()];
    const guildId = dependencies.config.RAD_DISCORD_GUILD_ID;
    if (guildId) {
      await client.guilds.cache.get(guildId)?.commands.set(commands);
    } else {
      await client.application?.commands.set(commands);
    }
  });
  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "rad-task") return;
    void handleTaskCommand(interaction, dependencies);
  });
  await client.login(token);
  return client;
}

async function handleTaskCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: DiscordBotDependencies,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const input = commandInputSchema.parse({
      repository: interaction.options.getString("repository", true),
      task: interaction.options.getString("task", true),
      branch: interaction.options.getString("branch") ?? "main",
    });
    let repository = await dependencies.repository.findRepositoryByRemoteUrl(
      input.repository,
    );
    repository ??= await dependencies.repository.createRepository({
      id: randomUUID(),
      remoteUrl: input.repository,
      defaultBranch: input.branch,
    });
    const workspaceId = randomUUID();
    const workspace = await dependencies.repository.createWorkspace({
      id: workspaceId,
      ownerUserId: stableUserId(interaction.user.id),
      repositoryId: repository.id,
      branchName: `agent/${workspaceId}`,
      expiresAt: new Date(
        Date.now() + dependencies.config.RAD_WORKSPACE_TTL_SECONDS * 1000,
      ),
    });
    await dependencies.reconciler.reconcile(workspace.id);
    await interaction.editReply(`Workspace ${workspace.id} is ready. Codex is working…`);
    const task = await dependencies.taskService.run(
      workspace.id,
      input.task,
      `discord:${interaction.user.id}`,
    );
    const result = task.result?.slice(0, 1_700) || "Task completed without a message.";
    await interaction.editReply(
      `Task ${task.id} completed in workspace ${workspace.id}.\n\n${result}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown task error";
    await interaction.editReply(`Task failed: ${message.slice(0, 1_800)}`);
  }
}

function stableUserId(discordUserId: string): string {
  const bytes = createHash("sha256")
    .update("remote-agent-devbox:discord:")
    .update(discordUserId)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

