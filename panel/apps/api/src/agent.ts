import type { AgentStatus } from "@zomboid/contracts";

export interface AgentAdapter {
  getStatus(serverId: string): Promise<AgentStatus>;
}

export class FakeAgentAdapter implements AgentAdapter {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async getStatus(serverId: string): Promise<AgentStatus> {
    const checkedAt = this.now();
    const checkedAtIso = checkedAt.toISOString();
    const worldAgeSeconds = 86_400;
    const worldCreatedAt = new Date(checkedAt.getTime() - worldAgeSeconds * 1000);

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
      worldCreatedAt: worldCreatedAt.toISOString(),
      worldAgeSeconds,
      worldTime: {
        year: 1993,
        month: 7,
        day: 9,
        hour: 14,
        minute: 0,
        daysSurvived: 0,
        worldAgeMinutes: 300,
        updatedAt: checkedAtIso,
      },
      playerCount: 0,
      checkedAt: checkedAtIso,
    };
  }
}
