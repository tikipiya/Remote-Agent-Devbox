import { digestCanonical, type Sha256Digest } from "@rad/git-artifacts";
import type { RuntimeConfig } from "@rad/shared";

export function buildSecurityPostureHash(config: RuntimeConfig): Sha256Digest {
  return digestCanonical({
    schemaVersion: "tier1-security-posture-2",
    deploymentTier: config.RAD_DEPLOYMENT_TIER,
    sandboxBackend: config.RAD_SANDBOX_BACKEND,
    workspaceImage: config.RAD_WORKSPACE_IMAGE,
    workspaceNetwork: config.RAD_WORKSPACE_NETWORK,
    controlNetwork: config.RAD_CONTROL_NETWORK,
    workspaceMemoryMegabytes: config.RAD_WORKSPACE_MEMORY_MB,
    workspaceCpus: config.RAD_WORKSPACE_CPUS,
    workspacePids: config.RAD_WORKSPACE_PIDS,
    artifactRoot: config.RAD_ARTIFACT_ROOT,
    artifactVolume: config.RAD_ARTIFACT_VOLUME,
    artifactMaxBytes: config.RAD_ARTIFACT_MAX_BYTES,
    validatorImage: config.RAD_VALIDATOR_IMAGE,
    validatorImageDigest: config.RAD_VALIDATOR_IMAGE_DIGEST || null,
    validatorMemoryMegabytes: config.RAD_VALIDATOR_MEMORY_MB,
    validatorCpus: config.RAD_VALIDATOR_CPUS,
    validatorPids: config.RAD_VALIDATOR_PIDS,
    validatorTimeoutMilliseconds: config.RAD_VALIDATOR_TIMEOUT_MS,
    approvalTtlSeconds: config.RAD_APPROVAL_TTL_SECONDS,
    ideAccessCodeTtlSeconds: config.RAD_IDE_ACCESS_CODE_TTL_SECONDS,
    ideSessionTtlSeconds: config.RAD_IDE_SESSION_TTL_SECONDS,
    ideProxyPublicUrl: config.RAD_IDE_PROXY_PUBLIC_URL,
    ideProxySharedSecretConfigured: Boolean(config.RAD_IDE_PROXY_SHARED_SECRET),
    githubApiUrl: config.RAD_GITHUB_API_URL,
    githubAppId: config.RAD_GITHUB_APP_ID || null,
    githubInstallationId: config.RAD_GITHUB_INSTALLATION_ID ?? null,
    githubPrivateKeyConfigured: Boolean(config.RAD_GITHUB_PRIVATE_KEY_BASE64),
  });
}
