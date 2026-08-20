export type StructuralFile = Readonly<{
  pathBase64: string;
  oldBlob: string;
  newBlob: string;
  oldMode: string;
  newMode: string;
  status: "A" | "D" | "M" | "T";
}>;

const rawHeaderPattern = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([ADMT])$/;

export function parseRawDiff(raw: Buffer, maxFiles: number): StructuralFile[] {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error("maxFiles must be a positive integer");
  }

  const fields = splitNull(raw);
  if (fields.length % 2 !== 0) {
    throw new Error("git emitted a malformed raw diff");
  }

  const files: StructuralFile[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    if (files.length >= maxFiles) {
      throw new Error(`raw diff exceeds the ${maxFiles} file limit`);
    }

    const header = fields[index]!.toString("ascii");
    const match = rawHeaderPattern.exec(header);
    if (!match) {
      throw new Error("git emitted an unsupported raw diff record");
    }

    const path = fields[index + 1]!;
    if (path.length === 0) {
      throw new Error("git emitted an empty path");
    }

    files.push({
      pathBase64: path.toString("base64"),
      oldMode: match[1]!,
      newMode: match[2]!,
      oldBlob: match[3]!,
      newBlob: match[4]!,
      status: match[5]! as StructuralFile["status"]
    });
  }

  return files;
}

function splitNull(raw: Buffer): Buffer[] {
  if (raw.length === 0) {
    return [];
  }

  if (raw[raw.length - 1] !== 0) {
    throw new Error("git raw diff is not NUL terminated");
  }

  const fields: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === 0) {
      fields.push(raw.subarray(start, index));
      start = index + 1;
    }
  }
  return fields;
}
