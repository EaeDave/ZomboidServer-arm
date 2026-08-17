package executor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/capabilities"
)

func testExecutor(t *testing.T) *Executor {
	t.Helper()
	directory := t.TempDir()
	privileged := filepath.Join(directory, "pz-agent-priv")
	privilegedScript := `#!/bin/sh
set -eu
operation="$1"
payload="$(cat)"
[ -n "$payload" ] || payload='{}'
printf '{"status":"succeeded","operation":"%s","payload":%s}\n' "$operation" "$payload"
`
	if err := os.WriteFile(privileged, []byte(privilegedScript), 0o700); err != nil {
		t.Fatal(err)
	}
	sudo := filepath.Join(directory, "sudo")
	if err := os.WriteFile(sudo, []byte("#!/bin/sh\n[ \"$1\" = -n ] && shift\nexec \"$@\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	return &Executor{PrivilegedCommand: privileged}
}

func input(values map[string]any) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(values))
	for name, value := range values {
		encoded, _ := json.Marshal(value)
		result[name] = encoded
	}
	return result
}

func TestExecuteMapsCapabilityToBoundedHostOperation(t *testing.T) {
	executor := testExecutor(t)
	result, err := executor.Execute(context.Background(), "rcon.players", input(nil))
	if err != nil {
		t.Fatal(err)
	}
	object, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type = %T, want map[string]any", result)
	}
	if object["operation"] != "rcon" {
		t.Fatalf("operation = %v, want rcon", object["operation"])
	}
	payload, ok := object["payload"].(map[string]any)
	if !ok || payload["command"] != "players" {
		t.Fatalf("payload = %#v, want players command", object["payload"])
	}
}

func TestExecuteRejectsUnknownAndInvalidInput(t *testing.T) {
	executor := testExecutor(t)
	if _, err := executor.Execute(context.Background(), "shell", input(nil)); err == nil {
		t.Fatal("unknown capability succeeded")
	}
	if _, err := executor.Execute(context.Background(), "logs.tail", input(map[string]any{"lines": 1001})); err == nil {
		t.Fatal("out-of-range line count succeeded")
	}
	if _, err := executor.Execute(context.Background(), "rcon.servermsg", input(map[string]any{"message": "line one\nline two"})); err == nil {
		t.Fatal("newline-bearing RCON argument succeeded")
	}
	if _, err := executor.Execute(context.Background(), "server.status", input(map[string]any{"command": "id"})); err == nil {
		t.Fatal("unexpected capability argument succeeded")
	}
}

func TestRegistryIdentifiersAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for _, capability := range capabilities.Registry {
		if seen[capability.ID] {
			t.Fatalf("duplicate capability %q", capability.ID)
		}
		seen[capability.ID] = true
		if capability.Mode != "direct" && capability.Mode != "job" {
			t.Fatalf("capability %q has invalid mode %q", capability.ID, capability.Mode)
		}
	}
}
