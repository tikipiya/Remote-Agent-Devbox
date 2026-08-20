import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import { sha256DigestSchema, type Sha256Digest } from "@rad/git-artifacts";
import { RadError } from "@rad/shared";

export interface StoredArtifact {
  artifactDigest: Sha256Digest;
  storageKey: string;
  sizeBytes: number;
}

export class ArtifactStore {
  private readonly root: string;
  private readonly stagingRoot: string;
  private readonly digestRoot: string;

  public constructor(root: string, private readonly maxBytes: number) {
    if (!isAbsolute(root)) {
      throw new RadError("INVALID_ARTIFACT_ROOT", "Artifact root must be absolute");
    }
    this.root = resolve(root);
    this.stagingRoot = join(this.root, ".staging");
    this.digestRoot = join(this.root, "sha256");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.digestRoot, { recursive: true, mode: 0o700 });
  }

  public stagingPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new RadError("INVALID_ARTIFACT_ID", "Artifact ID must be a UUID");
    }
    return join(this.stagingRoot, `${id}.bundle`);
  }

  public async commit(stagingPath: string): Promise<StoredArtifact> {
    this.requireStagingPath(stagingPath);
    const metadata = await lstat(stagingPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RadError("INVALID_ARTIFACT_FILE", "Staged artifact must be a regular file");
    }
    if (metadata.size <= 0 || metadata.size > this.maxBytes) {
      throw new RadError(
        "ARTIFACT_SIZE_INVALID",
        `Artifact size ${metadata.size} is outside the configured limit`,
      );
    }

    const artifactDigest = await digestFile(stagingPath);
    const hexDigest = artifactDigest.slice("sha256:".length);
    const storageKey = `sha256/${hexDigest}.bundle`;
    const destination = this.resolve(storageKey);

    const handle = await open(stagingPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(stagingPath, destination);
      await chmod(destination, 0o400);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await lstat(destination);
      if (!existing.isFile() || existing.size !== metadata.size) {
        throw new RadError(
          "ARTIFACT_STORAGE_CONFLICT",
          `Existing artifact ${storageKey} does not match staged bytes`,
        );
      }
      const existingDigest = await digestFile(destination);
      if (existingDigest !== artifactDigest) {
        throw new RadError(
          "ARTIFACT_STORAGE_CONFLICT",
          `Existing artifact ${storageKey} failed digest verification`,
        );
      }
    } finally {
      await rm(stagingPath, { force: true });
    }

    return { artifactDigest, storageKey, sizeBytes: metadata.size };
  }

  public resolve(storageKey: string): string {
    if (!/^sha256\/[0-9a-f]{64}\.bundle$/.test(storageKey)) {
      throw new RadError("INVALID_STORAGE_KEY", "Artifact storage key is invalid");
    }
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new RadError("INVALID_STORAGE_KEY", "Artifact path escapes storage root");
    }
    return path;
  }

  public read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  private requireStagingPath(path: string): void {
    const resolvedPath = resolve(path);
    if (!resolvedPath.startsWith(`${this.stagingRoot}${sep}`)) {
      throw new RadError("INVALID_STAGING_PATH", "Staging path escapes artifact root");
    }
  }
}

async function digestFile(path: string): Promise<Sha256Digest> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return sha256DigestSchema.parse(`sha256:${hash.digest("hex")}`);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
