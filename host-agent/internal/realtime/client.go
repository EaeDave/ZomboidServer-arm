package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/capabilities"
	"github.com/EaeDave/ZomboidServer-arm/host-agent/internal/executor"
	"github.com/coder/websocket"
)

type Config struct {
	URL         string
	AgentID     string
	AccessToken string
	ServerID    string
}

type executeMessage struct {
	Type         string                     `json:"type"`
	RequestID    string                     `json:"requestId"`
	CapabilityID string                     `json:"capabilityId"`
	Input        map[string]json.RawMessage `json:"input"`
	TimeoutMS    int                        `json:"timeoutMs"`
	ActorRole    string                     `json:"actorRole"`
}

type resultMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	OK        bool   `json:"ok"`
	Result    any    `json:"result,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Client struct {
	config   Config
	executor *executor.Executor
	commands chan struct{}
}

func ConfigFromEnvironment() (Config, error) {
	config := Config{
		URL:         os.Getenv("PZ_AGENT_URL"),
		AgentID:     os.Getenv("PZ_AGENT_ID"),
		AccessToken: os.Getenv("PZ_AGENT_ACCESS_TOKEN"),
		ServerID:    os.Getenv("PZ_SERVER_ID"),
	}
	if config.ServerID == "" {
		config.ServerID = os.Getenv("PZ_SERVICE")
	}
	if config.URL == "" || config.AgentID == "" || config.AccessToken == "" || config.ServerID == "" {
		return Config{}, fmt.Errorf("PZ_AGENT_URL, PZ_AGENT_ID, PZ_AGENT_ACCESS_TOKEN, and PZ_SERVER_ID or PZ_SERVICE are required")
	}
	return config, nil
}

func New(config Config) *Client {
	return &Client{config: config, executor: executor.New(), commands: make(chan struct{}, 4)}
}

func (c *Client) Run(ctx context.Context) error {
	backoff := time.Second
	for ctx.Err() == nil {
		startedAt := time.Now()
		err := c.runConnection(ctx)
		if ctx.Err() != nil {
			return nil
		}
		log.Printf("realtime connection closed: %v", err)
		if time.Since(startedAt) >= time.Minute {
			backoff = time.Second
		}
		jitter := time.Duration(rand.IntN(500)) * time.Millisecond
		select {
		case <-time.After(backoff + jitter):
		case <-ctx.Done():
			return nil
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
	return nil
}

func (c *Client) runConnection(ctx context.Context) error {
	endpoint, err := c.endpoint()
	if err != nil {
		return err
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.config.AccessToken)
	dialCtx, cancelDial := context.WithTimeout(ctx, 10*time.Second)
	connection, _, err := websocket.Dial(dialCtx, endpoint, &websocket.DialOptions{HTTPHeader: header})
	cancelDial()
	if err != nil {
		return fmt.Errorf("dial realtime API: %w", err)
	}
	defer connection.CloseNow()
	connection.SetReadLimit(1 << 20)

	readyCtx, cancelReady := context.WithTimeout(ctx, 10*time.Second)
	_, ready, err := connection.Read(readyCtx)
	cancelReady()
	if err != nil {
		return fmt.Errorf("read control readiness: %w", err)
	}
	var readiness struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(ready, &readiness) != nil || readiness.Type != "control.ready" {
		return fmt.Errorf("control plane did not accept the realtime session")
	}

	hello, _ := json.Marshal(map[string]any{
		"type":            "agent.hello",
		"protocolVersion": 1,
		"serverId":        c.config.ServerID,
		"capabilities":    capabilities.Registry,
	})
	if err := connection.Write(ctx, websocket.MessageText, hello); err != nil {
		return fmt.Errorf("send capability registry: %w", err)
	}
	log.Printf("realtime agent connected for %s", c.config.ServerID)

	var writeMu sync.Mutex
	pingCtx, cancelPing := context.WithCancel(ctx)
	defer cancelPing()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				pingTimeout, cancel := context.WithTimeout(pingCtx, 5*time.Second)
				writeMu.Lock()
				err := connection.Ping(pingTimeout)
				writeMu.Unlock()
				cancel()
				if err != nil {
					connection.CloseNow()
					return
				}
			case <-pingCtx.Done():
				return
			}
		}
	}()

	for {
		messageType, payload, err := connection.Read(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		if messageType != websocket.MessageText {
			continue
		}
		var message executeMessage
		if err := json.Unmarshal(payload, &message); err != nil || message.Type != "command.execute" || message.RequestID == "" {
			continue
		}
		select {
		case c.commands <- struct{}{}:
			go c.execute(pingCtx, connection, &writeMu, message)
		default:
			c.writeResult(
				pingCtx,
				connection,
				&writeMu,
				message.RequestID,
				nil,
				fmt.Errorf("too many realtime commands are already running"),
			)
		}
	}
}

func (c *Client) execute(parent context.Context, connection *websocket.Conn, writeMu *sync.Mutex, message executeMessage) {
	defer func() { <-c.commands }()
	timeout := time.Duration(message.TimeoutMS) * time.Millisecond
	if timeout < time.Second || timeout > 120*time.Second {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	var result any
	var err error
	capability, known := capabilities.Find(message.CapabilityID)
	if !known || !roleAtLeast(message.ActorRole, capability.Role) {
		err = fmt.Errorf("actor role is not allowed to execute %s", message.CapabilityID)
	} else {
		result, err = c.executor.Execute(ctx, message.CapabilityID, message.Input)
	}
	c.writeResult(parent, connection, writeMu, message.RequestID, result, err)
}

func (c *Client) writeResult(
	parent context.Context,
	connection *websocket.Conn,
	writeMu *sync.Mutex,
	requestID string,
	result any,
	commandError error,
) {
	response := resultMessage{Type: "command.result", RequestID: requestID, OK: commandError == nil, Result: result}
	if commandError != nil {
		response.Error = boundedError(commandError.Error())
	}
	payload, _ := json.Marshal(response)
	writeCtx, cancelWrite := context.WithTimeout(parent, 5*time.Second)
	defer cancelWrite()
	writeMu.Lock()
	defer writeMu.Unlock()
	if err := connection.Write(writeCtx, websocket.MessageText, payload); err != nil {
		log.Printf("send command result %s: %v", requestID, err)
	}
}

func boundedError(message string) string {
	const limit = 2000
	if utf8.RuneCountInString(message) <= limit {
		return message
	}
	return string([]rune(message)[:limit])
}

func roleAtLeast(actual, required string) bool {
	actualRank, requiredRank := roleRank(actual), roleRank(required)
	return actualRank >= requiredRank && requiredRank >= 0
}

func roleRank(role string) int {
	switch role {
	case "viewer":
		return 0
	case "operator":
		return 1
	case "admin":
		return 2
	default:
		return -1
	}
}

func (c *Client) endpoint() (string, error) {
	endpoint, err := url.Parse(c.config.URL)
	if err != nil {
		return "", fmt.Errorf("parse PZ_AGENT_URL: %w", err)
	}
	switch endpoint.Scheme {
	case "https":
		endpoint.Scheme = "wss"
	case "wss":
	case "http":
		if os.Getenv("PZ_AGENT_ALLOW_INSECURE") != "1" {
			return "", fmt.Errorf("PZ_AGENT_URL must use https or wss")
		}
		endpoint.Scheme = "ws"
	case "ws":
		if os.Getenv("PZ_AGENT_ALLOW_INSECURE") != "1" {
			return "", fmt.Errorf("PZ_AGENT_URL must use https or wss")
		}
	default:
		return "", fmt.Errorf("PZ_AGENT_URL must use https or wss")
	}
	endpoint.Path = path.Join("/", endpoint.Path, "api", "agents", c.config.AgentID, "realtime")
	query := endpoint.Query()
	query.Set("serverId", c.config.ServerID)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}

func RunFromEnvironment() error {
	config, err := ConfigFromEnvironment()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return New(config).Run(ctx)
}
