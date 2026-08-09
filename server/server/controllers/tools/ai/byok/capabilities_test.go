package byok

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// TestCapabilitiesReportsMissingWithZeroEnv verifies the documented OSS-mode
// behavior: the AI server can boot with zero provider keys and the capability
// endpoint reports every provider as `missing-key` without crashing.
func TestCapabilitiesReportsMissingWithZeroEnv(t *testing.T) {
	for _, vars := range providerEnvVars {
		for _, v := range vars {
			t.Setenv(v, "")
		}
	}
	// Snapshot + clear session keys for the duration of the test.
	for name := range providerEnvVars {
		t.Cleanup(func(n string) func() {
			prev := sessionStore.get(n)
			return func() { sessionStore.set(n, prev) }
		}(name))
		sessionStore.set(name, "")
	}

	req := httptest.NewRequest("GET", "/api/AI/Capabilities", nil)
	rec := httptest.NewRecorder()
	CapabilitiesHandler(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status=%d, want 200", rec.Code)
	}
	var got CapabilitiesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for name := range providerEnvVars {
		p, ok := got.Providers[name]
		if !ok {
			t.Errorf("provider %s missing from response", name)
			continue
		}
		if p.Status != "missing-key" || p.Source != "" {
			t.Errorf("provider %s: got {%s, %s}, want {missing-key, \"\"}", name, p.Status, p.Source)
		}
	}
}

// TestCapabilitiesReportsByokSessionAfterConfigure verifies that the editor's
// Settings panel can read back its own configured BYOK key — the capability
// endpoint must mark the provider `ready` with source `byok-session` once a
// key has been stored via POST /api/AI/ConfigureKeys.
func TestCapabilitiesReportsByokSessionAfterConfigure(t *testing.T) {
	for _, v := range providerEnvVars["anthropic"] {
		t.Setenv(v, "")
	}
	sessionStore.set("anthropic", "configured-by-test")
	t.Cleanup(func() { sessionStore.set("anthropic", "") })

	req := httptest.NewRequest("GET", "/api/AI/Capabilities", nil)
	rec := httptest.NewRecorder()
	CapabilitiesHandler(rec, req)

	var got CapabilitiesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	p := got.Providers["anthropic"]
	if p.Status != "ready" || p.Source != "byok-session" {
		t.Errorf("got {%s, %s}, want {ready, byok-session}", p.Status, p.Source)
	}
}

// TestCapabilitiesEnvBeatsByokSession verifies the precedence rule: an env-
// supplied key is reported as `env` even if a session key is also present.
func TestCapabilitiesEnvBeatsByokSession(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-env")
	sessionStore.set("openai", "sk-session")
	t.Cleanup(func() { sessionStore.set("openai", "") })

	req := httptest.NewRequest("GET", "/api/AI/Capabilities", nil)
	rec := httptest.NewRecorder()
	CapabilitiesHandler(rec, req)

	var got CapabilitiesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	p := got.Providers["openai"]
	if p.Status != "ready" || p.Source != "env" {
		t.Errorf("got {%s, %s}, want {ready, env}", p.Status, p.Source)
	}
}

func TestCapabilitiesReportsOpenSourceBuildMode(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/AI/Capabilities", nil)
	rec := httptest.NewRecorder()
	CapabilitiesHandler(rec, req)

	var got CapabilitiesResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.BuildMode != "oss" {
		t.Errorf("BuildMode=%q, want oss", got.BuildMode)
	}
}
