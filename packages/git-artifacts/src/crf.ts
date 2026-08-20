import { createHash } from "node:crypto";

import { z } from "zod";

import { sha256DigestSchema, type Sha256Digest } from "./artifact.js";

const objectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const canonicalBase64Schema = z.string().min(1).refine((value) => {
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}, "path must use canonical base64");

export const structuralFileSchema = z
  .object({
    pathBase64: canonicalBase64Schema,
    oldBlob: objectIdSchema,
    newBlob: objectIdSchema,
    oldMode: z.string().regex(/^\d{6}$/),
    newMode: z.string().regex(/^\d{6}$/),
    status: z.enum(["A", "D", "M", "T"])
  })
  .strict();
export type StructuralFile = z.infer<typeof structuralFileSchema>;

export const validatorManifestSchema = z
  .object({
    schemaVersion: z.literal("git-structural-manifest-1"),
    artifactDigest: z.string().regex(/^[0-9a-f]{64}$/),
    gitObjectFormat: z.enum(["sha1", "sha256"]),
    baseCommit: objectIdSchema,
    targetCommit: objectIdSchema,
    targetTree: objectIdSchema,
    files: z.array(structuralFileSchema).max(10_000)
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedLength = manifest.gitObjectFormat === "sha1" ? 40 : 64;
    for (const field of ["baseCommit", "targetCommit", "targetTree"] as const) {
      if (manifest[field].length !== expectedLength) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} does not match the declared Git object format`
        });
      }
    }
    for (const [index, file] of manifest.files.entries()) {
      if (file.oldBlob.length !== expectedLength || file.newBlob.length !== expectedLength) {
        context.addIssue({
          code: "custom",
          path: ["files", index],
          message: "blob ID does not match the declared Git object format"
        });
      }
    }
  });
export type ValidatorManifest = z.infer<typeof validatorManifestSchema>;

export const validatorProfileSchema = z
  .object({
    schemaVersion: z.literal("validator-profile-1"),
    imageDigest: sha256DigestSchema,
    gitBinaryDigest: sha256DigestSchema,
    crfVersion: z.literal("CRF-1"),
    canonicalizerDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    runnerConfigDigest: sha256DigestSchema
  })
  .strict();
export type ValidatorProfile = z.infer<typeof validatorProfileSchema>;

export const reviewManifestSchema = z
  .object({
    crfVersion: z.literal("CRF-1"),
    repositoryId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    gitObjectFormat: z.enum(["sha1", "sha256"]),
    baseCommit: objectIdSchema,
    targetCommit: objectIdSchema,
    targetTree: objectIdSchema,
    artifactDigest: sha256DigestSchema,
    validatorProfileDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    securityEpoch: z.number().int().positive(),
    deploymentTier: z.number().int().min(1).max(3),
    securityPostureHash: sha256DigestSchema,
    files: z.array(structuralFileSchema).max(10_000)
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedLength = manifest.gitObjectFormat === "sha1" ? 40 : 64;
    for (const field of ["baseCommit", "targetCommit", "targetTree"] as const) {
      if (manifest[field].length !== expectedLength) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} does not match the declared Git object format`,
        });
      }
    }
    for (const [index, file] of manifest.files.entries()) {
      if (file.oldBlob.length !== expectedLength || file.newBlob.length !== expectedLength) {
        context.addIssue({
          code: "custom",
          path: ["files", index],
          message: "blob ID does not match the declared Git object format",
        });
      }
    }
  });
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("canonical JSON accepts only safe integers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON accepts only plain objects");
    }
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => {
        if (entry === undefined) throw new TypeError("canonical JSON rejects undefined");
        return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function digestCanonical(value: unknown): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`
  );
}

export function canonicalizeFiles(files: readonly StructuralFile[]): StructuralFile[] {
  const parsed = files.map((file) => structuralFileSchema.parse(file));
  parsed.sort((left, right) => {
    const pathOrder = Buffer.compare(
      Buffer.from(left.pathBase64, "base64"),
      Buffer.from(right.pathBase64, "base64")
    );
    if (pathOrder !== 0) return pathOrder;
    return compareText(canonicalJson(left), canonicalJson(right));
  });

  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1]!.pathBase64 === parsed[index]!.pathBase64) {
      throw new TypeError("structural manifest contains a duplicate path");
    }
  }
  return parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
