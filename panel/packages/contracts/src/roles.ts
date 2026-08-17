export const capabilityRoles = ["viewer", "operator", "admin"] as const;

export type CapabilityRole = (typeof capabilityRoles)[number];

export const roleRank: Record<CapabilityRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export const directCapabilityRoles: Readonly<Record<string, CapabilityRole>> = {
  "server.status": "viewer",
  "logs.tail": "viewer",
  "settings.read": "admin",
  "config.read": "operator",
  "mods.list": "viewer",
  "rcon.help": "viewer",
  "rcon.players": "viewer",
  "rcon.servermsg": "operator",
  "rcon.kickuser": "admin",
  "rcon.save": "operator",
  "world.save": "operator",
};
