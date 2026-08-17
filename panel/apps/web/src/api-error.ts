export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function throwApiError(response: Response, message: string): never {
  if (response.status === 401) window.dispatchEvent(new Event("zomboid-auth-expired"));
  throw new ApiError(message, response.status);
}
