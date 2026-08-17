import type {
  AgentCapabilitiesResponse,
  DirectCommandRequest,
  DirectCommandResponse,
} from "@zomboid/contracts";
import { throwApiError } from "./api-error";

function apiErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return undefined;
  return typeof error.message === "string" ? error.message : undefined;
}

export async function getAgentCapabilities(serverId: string): Promise<AgentCapabilitiesResponse> {
  const response = await fetch(`/api/servers/${serverId}/capabilities`, {
    credentials: "same-origin",
  });
  if (!response.ok) throwApiError(response, `Capability request failed: ${response.status}`);
  return response.json() as Promise<AgentCapabilitiesResponse>;
}

export async function executeDirectCommand(
  serverId: string,
  request: DirectCommandRequest,
): Promise<DirectCommandResponse> {
  const response = await fetch(`/api/servers/${serverId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(request),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throwApiError(response, apiErrorMessage(body) ?? `Realtime command failed: ${response.status}`);
  }
  return body as DirectCommandResponse;
}
