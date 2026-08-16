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
      playerCount: 0,
      checkedAt: this.now().toISOString(),
    };
  }
}
