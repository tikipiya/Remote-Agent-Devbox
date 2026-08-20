import { RadError } from "@rad/shared";
import type {
  InstanceMetadataRepository,
  InstanceSecurityMetadata,
} from "@rad/workspace-state";

export interface OperationalGuard {
  assertAvailable(operation: string): Promise<InstanceSecurityMetadata>;
}

export class MaintenanceModeGuard implements OperationalGuard {
  public constructor(
    private readonly metadata: Pick<InstanceMetadataRepository, "getSecurityMetadata">,
  ) {}

  public async assertAvailable(operation: string): Promise<InstanceSecurityMetadata> {
    const metadata = await this.metadata.getSecurityMetadata();
    if (!metadata) {
      throw new RadError("SECURITY_CONTEXT_MISSING", "Instance security metadata is missing");
    }
    if (metadata.maintenanceMode) {
      throw new RadError(
        "MAINTENANCE_MODE_ACTIVE",
        `${operation} is unavailable while security maintenance is active`,
      );
    }
    return metadata;
  }
}
