package capabilities

type Argument struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Required    bool   `json:"required"`
	MaxLength   int    `json:"maxLength,omitempty"`
	Minimum     int    `json:"minimum,omitempty"`
	Maximum     int    `json:"maximum,omitempty"`
	Placeholder string `json:"placeholder,omitempty"`
}

type Capability struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Category      string     `json:"category"`
	Mode          string     `json:"mode"`
	Role          string     `json:"role"`
	Effects       []string   `json:"effects"`
	Arguments     []Argument `json:"arguments"`
	OperationKind string     `json:"operationKind,omitempty"`
}

var Registry = []Capability{
	{ID: "server.status", Title: "Server status", Description: "Read the current service, socket, build, player, and RCON state.", Category: "Server", Mode: "direct", Role: "viewer", Effects: []string{"read"}, Arguments: []Argument{}},
	{ID: "logs.tail", Title: "Recent logs", Description: "Read a bounded tail of the game console log.", Category: "Diagnostics", Mode: "direct", Role: "viewer", Effects: []string{"read"}, Arguments: []Argument{{Name: "lines", Label: "Lines", Description: "Number of recent lines to return.", Type: "integer", Required: false, Minimum: 1, Maximum: 1000, Placeholder: "100"}}},
	{ID: "settings.read", Title: "Server access settings", Description: "Read public name, ports, and password configuration metadata.", Category: "Settings", Mode: "direct", Role: "admin", Effects: []string{"read", "sensitive"}, Arguments: []Argument{}},
	{ID: "config.read", Title: "Full configuration", Description: "Read structured server and Sandbox settings with revision metadata.", Category: "Settings", Mode: "direct", Role: "operator", Effects: []string{"read"}, Arguments: []Argument{}},
	{ID: "mods.list", Title: "Installed mods", Description: "Read installed, enabled, disabled, and tracked Workshop content.", Category: "Mods", Mode: "direct", Role: "viewer", Effects: []string{"read"}, Arguments: []Argument{}},
	{ID: "rcon.help", Title: "RCON help", Description: "Ask the running game for its current administrative command list.", Category: "RCON", Mode: "direct", Role: "viewer", Effects: []string{"read"}, Arguments: []Argument{}},
	{ID: "rcon.players", Title: "List players", Description: "List players currently connected to the game server.", Category: "RCON", Mode: "direct", Role: "viewer", Effects: []string{"read"}, Arguments: []Argument{}},
	{ID: "rcon.servermsg", Title: "Broadcast message", Description: "Send an announcement to every connected player.", Category: "RCON", Mode: "direct", Role: "operator", Effects: []string{"player-visible"}, Arguments: []Argument{{Name: "message", Label: "Message", Description: "Message shown to connected players.", Type: "string", Required: true, MaxLength: 500, Placeholder: "Maintenance starts in five minutes"}}},
	{ID: "rcon.kickuser", Title: "Kick player", Description: "Disconnect one player with a visible reason.", Category: "RCON", Mode: "direct", Role: "admin", Effects: []string{"player-action"}, Arguments: []Argument{{Name: "username", Label: "Username", Description: "Exact player name.", Type: "string", Required: true, MaxLength: 128}, {Name: "reason", Label: "Reason", Description: "Reason shown to the player.", Type: "string", Required: true, MaxLength: 500, Placeholder: "Maintenance"}}},
	{ID: "rcon.save", Title: "Save world through RCON", Description: "Flush the current world state to disk through the game console.", Category: "RCON", Mode: "direct", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{}},
	{ID: "world.save", Title: "Save world", Description: "Verify the server is ready and save the current world safely.", Category: "World", Mode: "direct", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{}},

	{ID: "server.start", Title: "Start server", Description: "Start the game service and wait for readiness.", Category: "Server", Mode: "job", Role: "operator", Effects: []string{"lifecycle"}, Arguments: []Argument{}, OperationKind: "start"},
	{ID: "server.stop", Title: "Stop server", Description: "Notify players, save the world, and stop the game service.", Category: "Server", Mode: "job", Role: "operator", Effects: []string{"lifecycle", "player-visible"}, Arguments: []Argument{}, OperationKind: "stop"},
	{ID: "server.restart", Title: "Restart server", Description: "Notify players, save the world, and restart safely.", Category: "Server", Mode: "job", Role: "operator", Effects: []string{"lifecycle", "player-visible"}, Arguments: []Argument{}, OperationKind: "restart"},
	{ID: "backup.create", Title: "Create backup", Description: "Save and archive world and server configuration data.", Category: "Backups", Mode: "job", Role: "operator", Effects: []string{"write", "filesystem"}, Arguments: []Argument{{Name: "keep", Label: "Backups to keep", Description: "Optional retention count.", Type: "integer", Required: false, Minimum: 1, Maximum: 100}}, OperationKind: "backup"},
	{ID: "build.update", Title: "Update game build", Description: "Back up, download, install, and restart the configured game build.", Category: "Server", Mode: "job", Role: "operator", Effects: []string{"download", "lifecycle", "filesystem"}, Arguments: []Argument{}, OperationKind: "build.update"},
	{ID: "mods.add", Title: "Add Workshop item", Description: "Install a Workshop mod or collection and update configuration.", Category: "Mods", Mode: "job", Role: "operator", Effects: []string{"download", "filesystem"}, Arguments: []Argument{{Name: "workshopId", Label: "Workshop ID", Description: "Numeric Workshop item or collection ID.", Type: "string", Required: true, MaxLength: 20}}, OperationKind: "mods.add"},
	{ID: "mods.remove", Title: "Remove mods", Description: "Remove one or more configured mod IDs.", Category: "Mods", Mode: "job", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{{Name: "modIds", Label: "Mod IDs", Description: "Mod IDs to remove.", Type: "string-list", Required: true}}, OperationKind: "mods.remove"},
	{ID: "mods.configure", Title: "Configure mods", Description: "Apply enabled, disabled, and ordered mod configuration.", Category: "Mods", Mode: "job", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{}, OperationKind: "mods.configure"},
	{ID: "mods.update.check", Title: "Check mod updates", Description: "Query Workshop metadata for tracked mod updates.", Category: "Mods", Mode: "job", Role: "viewer", Effects: []string{"network", "read"}, Arguments: []Argument{}, OperationKind: "mods.update.check"},
	{ID: "mods.update.apply", Title: "Apply mod updates", Description: "Wait for safety conditions, back up, update mods, and optionally restart.", Category: "Mods", Mode: "job", Role: "operator", Effects: []string{"download", "lifecycle", "filesystem"}, Arguments: []Argument{}, OperationKind: "mods.update.apply"},
	{ID: "settings.update", Title: "Update access settings", Description: "Update server visibility, name, password, and ports.", Category: "Settings", Mode: "job", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{}, OperationKind: "settings.update"},
	{ID: "config.update", Title: "Update configuration", Description: "Apply revision-checked server or Sandbox changes.", Category: "Settings", Mode: "job", Role: "operator", Effects: []string{"write"}, Arguments: []Argument{}, OperationKind: "config.update"},
	{ID: "world.reset", Title: "Reset world", Description: "Back up and delete map and player state for a fresh world.", Category: "World", Mode: "job", Role: "admin", Effects: []string{"destructive", "lifecycle", "filesystem"}, Arguments: []Argument{}, OperationKind: "world.reset"},
}

func Find(id string) (Capability, bool) {
	for _, capability := range Registry {
		if capability.ID == id {
			return capability, true
		}
	}
	return Capability{}, false
}
