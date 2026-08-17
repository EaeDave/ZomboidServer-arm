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
}
