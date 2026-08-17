package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/capabilities"
)

type Executor struct {
	PrivilegedCommand string
}

func New() *Executor {
	command := os.Getenv("PZ_AGENT_PRIV")
	if command == "" {
		command = "/usr/local/sbin/pz-agent-priv"
	}
	return &Executor{PrivilegedCommand: command}
}

func (e *Executor) Execute(ctx context.Context, capabilityID string, input map[string]json.RawMessage) (any, error) {
	capability, ok := capabilities.Find(capabilityID)
	if !ok || capability.Mode != "direct" {
		return nil, fmt.Errorf("capability %q is not a direct command", capabilityID)
	}
	if err := validateInput(capability, input); err != nil {
		return nil, err
	}

	var args []string
	var stdin []byte
	switch capabilityID {
	case "server.status":
		args = []string{"status"}
	case "logs.tail":
		lines, err := optionalInteger(input, "lines", 100, 1, 1000)
		if err != nil {
			return nil, err
		}
		args = []string{"logs", strconv.Itoa(lines)}
	case "settings.read":
		args = []string{"settings-read"}
	case "config.read":
		args = []string{"config-read"}
	case "mods.list":
		args = []string{"mods-list"}
	case "world.save":
		args = []string{"world-save"}
	case "rcon.help", "rcon.players", "rcon.save":
		command := strings.TrimPrefix(capabilityID, "rcon.")
		args = []string{"rcon"}
		stdin, _ = json.Marshal(map[string]any{"command": command, "args": []string{}})
	case "rcon.servermsg":
		message, err := requiredString(input, "message", 500)
		if err != nil {
			return nil, err
		}
		args = []string{"rcon"}
		stdin, _ = json.Marshal(map[string]any{"command": "servermsg", "args": []string{message}})
	case "rcon.kickuser":
		username, err := requiredString(input, "username", 128)
		if err != nil {
			return nil, err
		}
		reason, err := requiredString(input, "reason", 500)
		if err != nil {
			return nil, err
		}
		args = []string{"rcon"}
		stdin, _ = json.Marshal(map[string]any{"command": "kickuser", "args": []string{username, reason}})
	default:
		return nil, fmt.Errorf("capability %q has no executor", capabilityID)
	}

	command := exec.CommandContext(ctx, "sudo", append([]string{"-n", e.PrivilegedCommand}, args...)...)
	command.Stdin = bytes.NewReader(stdin)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("command timed out")
		}
		message := strings.TrimSpace(stderr.String())
		if len(message) > 2000 {
			message = message[:2000]
		}
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("host command failed: %s", message)
	}

	var result any
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return nil, fmt.Errorf("host command returned invalid JSON")
	}
	return result, nil
}

func validateInput(capability capabilities.Capability, input map[string]json.RawMessage) error {
	arguments := make(map[string]capabilities.Argument, len(capability.Arguments))
	for _, argument := range capability.Arguments {
		arguments[argument.Name] = argument
		if argument.Required {
			if _, ok := input[argument.Name]; !ok {
				return fmt.Errorf("%s is required", argument.Name)
			}
		}
	}
	for name := range input {
		if _, ok := arguments[name]; !ok {
			return fmt.Errorf("%s is not accepted by %s", name, capability.ID)
		}
	}
	return nil
}

func requiredString(input map[string]json.RawMessage, name string, maxLength int) (string, error) {
	raw, ok := input[name]
	if !ok {
		return "", fmt.Errorf("%s is required", name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", name)
	}
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "\r\n") || len(value) > maxLength {
		return "", fmt.Errorf("%s is invalid", name)
	}
	return value, nil
}

func optionalInteger(input map[string]json.RawMessage, name string, fallback, minimum, maximum int) (int, error) {
	raw, ok := input[name]
	if !ok || string(raw) == "null" {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", name, minimum, maximum)
	}
	return value, nil
}
