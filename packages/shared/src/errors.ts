export class RadError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "RadError";
  }
}

