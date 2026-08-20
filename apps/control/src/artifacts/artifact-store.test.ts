import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "./artifact-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("ArtifactStore", () => {
  it("assigns server-side identity and never replaces content-addressed bytes", async () => {
    const root = await temporaryRoot();
    const store = new ArtifactStore(root, 1024);
    await store.initialize();
    const bytes = Buffer.from("untrusted git bundle");
    const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

    const firstPath = store.stagingPath(randomUUID());
    await writeFile(firstPath, bytes);
    const first = await store.commit(firstPath);
    const secondPath = store.stagingPath(randomUUID());
    await writeFile(secondPath, bytes);
    const second = await store.commit(secondPath);

    expect(first).toEqual({
      artifactDigest: expected,
      storageKey: `${expected.replace(":", "/")}/artifact.bundle`,
      sizeBytes: bytes.length,
    });
    expect(second).toEqual(first);
    await expect(store.read(first.storageKey)).resolves.toEqual(bytes);
  });

  it("rejects oversized files and paths outside trusted staging", async () => {
    const root = await temporaryRoot();
    const store = new ArtifactStore(root, 4);
    await store.initialize();
    const staged = store.stagingPath(randomUUID());
    await writeFile(staged, "12345");

    await expect(store.commit(staged)).rejects.toThrow(/configured limit/);
    await expect(store.commit(join(root, "outside.bundle"))).rejects.toThrow(
      /escapes artifact root/,
    );
    expect(() => store.resolve("sha256/../../secret.bundle")).toThrow(
      /storage key/,
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rad-artifacts-"));
  roots.push(root);
  return root;
}
