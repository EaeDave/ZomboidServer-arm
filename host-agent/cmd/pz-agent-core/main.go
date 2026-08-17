package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/user"
	"time"

	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/capabilities"
	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/executor"
	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/realtime"
)

type directRequest struct {
	CapabilityID string                     `json:"capabilityId"`
	Input        map[string]json.RawMessage `json:"input"`
	TimeoutMS    int                        `json:"timeoutMs,omitempty"`
}

var trustedLocalUser string

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "pz-agent-core:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: pz-agent-core {run|capabilities|direct}")
	}
	switch args[0] {
	case "run":
		return realtime.RunFromEnvironment()
	case "capabilities":
		return json.NewEncoder(os.Stdout).Encode(map[string]any{
			"protocolVersion": 1,
			"capabilities":    capabilities.Registry,
		})
	case "direct":
		var request directRequest
		decoder := json.NewDecoder(os.Stdin)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			return fmt.Errorf("invalid direct command request: %w", err)
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			return fmt.Errorf("invalid direct command request: trailing JSON data")
		}
		if request.Input == nil {
			request.Input = map[string]json.RawMessage{}
		}
		capability, ok := capabilities.Find(request.CapabilityID)
		if !ok || capability.Mode != "direct" {
			return fmt.Errorf("capability %q is not a direct command", request.CapabilityID)
		}
		if capability.Role == "admin" {
			current, err := user.Current()
			if err != nil || trustedLocalUser == "" || current.Username != trustedLocalUser {
				return fmt.Errorf("admin capabilities require the configured local server owner")
			}
		}
		timeout := time.Duration(request.TimeoutMS) * time.Millisecond
		if timeout < time.Second || timeout > 120*time.Second {
			timeout = 15 * time.Second
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		result, err := executor.New().Execute(ctx, request.CapabilityID, request.Input)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}
