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
	"unicode/utf8"

	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/capabilities"
)

type Executor struct {
	PrivilegedCommand string
}

const maxCommandOutput = 900 << 10

type boundedBuffer struct {
	buffer bytes.Buffer
	limit  int
	over   bool
}

func (b *boundedBuffer) Write(data []byte) (int, error) {
	remaining := b.limit - b.buffer.Len()
	if remaining > 0 {
		write := len(data)
		if write > remaining {
			write = remaining
		}
		_, _ = b.buffer.Write(data[:write])
	}
	if len(data) > remaining {
		b.over = true
	}
	return len(data), nil
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
		lines, err := optionalInteger(input, argumentOf(capability, "lines"), 50)
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
		message, err := requiredString(input, argumentOf(capability, "message"))
		if err != nil {
			return nil, err
		}
		args = []string{"rcon"}
		stdin, _ = json.Marshal(map[string]any{"command": "servermsg", "args": []string{message}})
	case "rcon.kickuser":
		username, err := requiredString(input, argumentOf(capability, "username"))
		if err != nil {
			return nil, err
		}
		reason, err := requiredString(input, argumentOf(capability, "reason"))
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
	stdout := &boundedBuffer{limit: maxCommandOutput}
	var stderr bytes.Buffer
	command.Stdout = stdout
	command.Stderr = &stderr
	runError := command.Run()
	if stdout.over {
		return nil, fmt.Errorf("host command output exceeded %d bytes", maxCommandOutput)
	}
	if runError != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("command timed out")
		}
		message := strings.TrimSpace(stderr.String())
		if len(message) > 2000 {
			cut := 2000
			for cut > 0 && !utf8.RuneStart(message[cut]) {
				cut--
			}
			message = message[:cut]
		}
		if message == "" {
			message = runError.Error()
		}
		return nil, fmt.Errorf("host command failed: %s", message)
	}

	var result any
	if err := json.Unmarshal(stdout.buffer.Bytes(), &result); err != nil {
		return nil, fmt.Errorf("host command returned invalid JSON")
	}
	if object, ok := result.(map[string]any); ok {
		status, _ := object["status"].(string)
		if status == "failed" || status == "blocked" || status == "unavailable" {
			message, _ := object["message"].(string)
			if message == "" {
				message = "host operation failed"
			}
			return nil, fmt.Errorf("%s", message)
		}
	}
	return result, nil
}
func argumentOf(capability capabilities.Capability, name string) capabilities.Argument {
	for _, argument := range capability.Arguments {
		if argument.Name == name {
			return argument
		}
	}
	return capabilities.Argument{Name: name}
}

func validateInput(capability capabilities.Capability, input map[string]json.RawMessage) error {
	arguments := make(map[string]capabilities.Argument, len(capability.Arguments))
	for _, argument := range capability.Arguments {
		arguments[argument.Name] = argument
		raw, present := input[argument.Name]
		if !present {
			if argument.Required {
				return fmt.Errorf("%s is required", argument.Name)
			}
			continue
		}
		if err := validateArgument(argument, raw); err != nil {
			return err
		}
	}
	for name := range input {
		if _, ok := arguments[name]; !ok {
			return fmt.Errorf("%s is not accepted by %s", name, capability.ID)
		}
	}
	return nil
}

func validateArgument(argument capabilities.Argument, raw json.RawMessage) error {
	switch argument.Type {
	case "string":
		var value string
		if json.Unmarshal(raw, &value) != nil ||
			(argument.Required && strings.TrimSpace(value) == "") ||
			strings.ContainsAny(value, "\r\n") ||
			(argument.MaxLength > 0 && utf8.RuneCountInString(value) > argument.MaxLength) {
			return fmt.Errorf("%s is invalid", argument.Name)
		}
	case "integer":
		var value int
		if json.Unmarshal(raw, &value) != nil ||
			(argument.Minimum != nil && value < *argument.Minimum) ||
			(argument.Maximum != nil && value > *argument.Maximum) {
			return fmt.Errorf("%s is outside its allowed range", argument.Name)
		}
	case "boolean":
		var value bool
		if json.Unmarshal(raw, &value) != nil {
			return fmt.Errorf("%s must be a boolean", argument.Name)
		}
	case "string-list":
		var values []string
		if json.Unmarshal(raw, &values) != nil || (argument.Required && len(values) == 0) {
			return fmt.Errorf("%s must be a non-empty list", argument.Name)
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" ||
				strings.ContainsAny(value, "\r\n") ||
				(argument.MaxLength > 0 && utf8.RuneCountInString(value) > argument.MaxLength) {
				return fmt.Errorf("%s contains an invalid value", argument.Name)
			}
		}
	default:
		return fmt.Errorf("%s has unsupported type %q", argument.Name, argument.Type)
	}
	return nil
}

func requiredString(input map[string]json.RawMessage, argument capabilities.Argument) (string, error) {
	raw, ok := input[argument.Name]
	if !ok {
		return "", fmt.Errorf("%s is required", argument.Name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", argument.Name)
	}
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "\r\n") ||
		(argument.MaxLength > 0 && utf8.RuneCountInString(value) > argument.MaxLength) {
		return "", fmt.Errorf("%s is invalid", argument.Name)
	}
	return value, nil
}

func optionalInteger(input map[string]json.RawMessage, argument capabilities.Argument, fallback int) (int, error) {
	raw, ok := input[argument.Name]
	if !ok || string(raw) == "null" {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil ||
		(argument.Minimum != nil && value < *argument.Minimum) ||
		(argument.Maximum != nil && value > *argument.Maximum) {
		return 0, fmt.Errorf("%s is outside its allowed range", argument.Name)
	}
	return value, nil
}
