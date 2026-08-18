import type { AgentStatus } from "@zomboid/contracts";

export interface AgentAdapter {
  getStatus(serverId: string): Promise<AgentStatus>;
}

export class FakeAgentAdapter implements AgentAdapter {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async getStatus(serverId: string): Promise<AgentStatus> {
    return {
      protocolVersion: 1,
      serverId,
      serviceName: "zomboid-b42",
      state: "active",
      substate: "running",
      listening: true,
      runtime: "fex",
      gameVersion: "42.20.2",
      uptimeSeconds: 3600,
      worldCreatedAt: "2026-08-15T00:00:00.000Z",
      worldAgeSeconds: 86_400,
      worldTime: {
        year: 1993,
        month: 7,
        day: 9,
        hour: 14,
        minute: 0,
        daysSurvived: 0,
        worldAgeMinutes: 300,
        updatedAt: this.now().toISOString(),
      },
      playerCount: 0,
      checkedAt: this.now().toISOString(),
    };
  }
}
