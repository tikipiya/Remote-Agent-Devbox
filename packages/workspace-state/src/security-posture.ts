import { RadError } from "@rad/shared";

import type { InstanceSecurityMetadata } from "./repository.js";

export interface ConfiguredSecurityPosture {
  deploymentTier: number;
  securityPostureHash: string;
}

export function assertStartupSecurityMetadata(
  stored: InstanceSecurityMetadata,
  configured: ConfiguredSecurityPosture,
): InstanceSecurityMetadata {
  if (configured.deploymentTier < stored.deploymentTier) {
    throw new RadError(
      "SECURITY_TIER_DOWNGRADE_BLOCKED",
      `Configured tier ${configured.deploymentTier} is below stored tier ${stored.deploymentTier}; an explicit security migration is required`,
    );
  }

  if (configured.deploymentTier > stored.deploymentTier) {
    throw new RadError(
      "SECURITY_TIER_UPGRADE_REQUIRED",
      `Configured tier ${configured.deploymentTier} is above stored tier ${stored.deploymentTier}; validate controls and run an explicit security migration`,
    );
  }

  if (configured.securityPostureHash !== stored.securityPostureHash) {
    throw new RadError(
      "SECURITY_POSTURE_MIGRATION_REQUIRED",
      "Security-sensitive configuration changed; an explicit security migration is required",
    );
  }

  return stored;
}
