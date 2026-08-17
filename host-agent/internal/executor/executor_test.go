package executor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
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
if [ "$operation" = world-save ]; then
  printf '{"status":"failed","message":"RCON unavailable"}\n'
  exit 0
fi
if [ "$operation" = mods-list ] && [ "${PZ_TEST_LARGE:-0}" = 1 ]; then
  printf '{"output":"'
  dd if=/dev/zero bs=1024 count=901 2>/dev/null | tr '\000' x
  printf '"}\n'
  exit 0
fi
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
	if _, err := executor.Execute(context.Background(), "server.start", input(nil)); err == nil {
		t.Fatal("job capability succeeded on the direct path")
	}
	if _, err := executor.Execute(context.Background(), "world.save", input(nil)); err == nil || !strings.Contains(err.Error(), "RCON unavailable") {
		t.Fatalf("structured host failure error = %v", err)
	}
	t.Setenv("PZ_TEST_LARGE", "1")
	if _, err := executor.Execute(context.Background(), "mods.list", input(nil)); err == nil || !strings.Contains(err.Error(), "output exceeded") {
		t.Fatalf("oversized output error = %v", err)
	}
}

func TestRegistryIdentifiersAreUnique(t *testing.T) {
	identifier := regexp.MustCompile(`^[a-z][a-z0-9.-]*$`)
	seen := make(map[string]bool)
	for _, capability := range capabilities.Registry {
		if seen[capability.ID] {
			t.Fatalf("duplicate capability %q", capability.ID)
		}
		seen[capability.ID] = true
		if !identifier.MatchString(capability.ID) || capability.Description == "" {
			t.Fatalf("capability %q violates the panel contract", capability.ID)
		}
		if capability.Mode != "direct" && capability.Mode != "job" {
			t.Fatalf("capability %q has invalid mode %q", capability.ID, capability.Mode)
		}
		if capability.Mode == "job" && capability.OperationKind == "" {
			t.Fatalf("job capability %q has no operation kind", capability.ID)
		}
		if len(capability.Effects) > 10 || len(capability.Arguments) > 20 {
			t.Fatalf("capability %q exceeds panel collection bounds", capability.ID)
		}
		effects := make(map[string]bool, len(capability.Effects))
		for _, effect := range capability.Effects {
			if effects[effect] {
				t.Fatalf("capability %q repeats effect %q", capability.ID, effect)
			}
			effects[effect] = true
		}
	}
}

func TestIntegerValidationSupportsZeroBounds(t *testing.T) {
	zero := 0
	ten := 10
	argument := capabilities.Argument{Type: "integer", Minimum: &zero, Maximum: &ten}
	if err := validateArgument(argument, json.RawMessage(`0`)); err != nil {
		t.Fatalf("zero lower bound rejected: %v", err)
	}
	if err := validateArgument(argument, json.RawMessage(`-1`)); err == nil {
		t.Fatal("value below zero lower bound succeeded")
	}

	negativeTen := -10
	argument = capabilities.Argument{Type: "integer", Minimum: &negativeTen, Maximum: &zero}
	if err := validateArgument(argument, json.RawMessage(`0`)); err != nil {
		t.Fatalf("zero upper bound rejected: %v", err)
	}
	if err := validateArgument(argument, json.RawMessage(`1`)); err == nil {
		t.Fatal("value above zero upper bound succeeded")
	}
}
