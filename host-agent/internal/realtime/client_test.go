package realtime

import (
	"strings"
	"testing"
)

func TestRoleAtLeast(t *testing.T) {
	for _, test := range []struct {
		actual   string
		required string
		allowed  bool
	}{
		{actual: "viewer", required: "viewer", allowed: true},
		{actual: "viewer", required: "operator", allowed: false},
		{actual: "operator", required: "viewer", allowed: true},
		{actual: "operator", required: "admin", allowed: false},
		{actual: "admin", required: "admin", allowed: true},
		{actual: "root", required: "viewer", allowed: false},
	} {
		if got := roleAtLeast(test.actual, test.required); got != test.allowed {
			t.Fatalf("roleAtLeast(%q, %q) = %v, want %v", test.actual, test.required, got, test.allowed)
		}
	}
}

func TestEndpointRequiresTLSAndPreservesBasePath(t *testing.T) {
	t.Setenv("PZ_AGENT_ALLOW_INSECURE", "")
	client := New(Config{
		URL:         "https://panel.example.com/control",
		AgentID:     "agent one",
		AccessToken: "secret",
		ServerID:    "zomboid-b42",
	})
	endpoint, err := client.endpoint()
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != "wss://panel.example.com/control/api/agents/agent%20one/realtime?serverId=zomboid-b42" {
		t.Fatalf("endpoint = %q", endpoint)
	}

	client.config.URL = "http://panel.example.com"
	if _, err := client.endpoint(); err == nil || !strings.Contains(err.Error(), "https or wss") {
		t.Fatalf("insecure endpoint error = %v", err)
	}

	t.Setenv("PZ_AGENT_ALLOW_INSECURE", "1")
	for _, rawURL := range []string{"http://panel.example.com", "ws://panel.example.com"} {
		client.config.URL = rawURL
		if _, err := client.endpoint(); err != nil {
			t.Fatalf("development endpoint %q: %v", rawURL, err)
		}
	}
	client.config.URL = "ftp://panel.example.com"
	if _, err := client.endpoint(); err == nil {
		t.Fatal("unsupported endpoint scheme succeeded")
	}

	client.config.URL = "https://panel.example.com"
	endpoint, err = client.endpoint()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(endpoint, "wss://panel.example.com/api/agents/") {
		t.Fatalf("root endpoint = %q", endpoint)
	}
}

func TestBoundedErrorPreservesUTF8AndLimitsUTF16Units(t *testing.T) {
	accented := boundedError(strings.Repeat("á", 2001))
	if len([]rune(accented)) != 2000 || !strings.HasSuffix(accented, "á") {
		t.Fatalf("bounded accented error has %d characters", len([]rune(accented)))
	}

	emoji := boundedError(strings.Repeat("😀", 1001))
	if len([]rune(emoji)) != 1000 || !strings.HasSuffix(emoji, "😀") {
		t.Fatalf("bounded emoji error has %d characters", len([]rune(emoji)))
	}
}
