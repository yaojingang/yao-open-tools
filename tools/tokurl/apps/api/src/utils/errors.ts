export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "service_error"
  ) {
    super(message);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
  );
}
