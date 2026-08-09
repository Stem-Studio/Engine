package byok

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
)

// ConfigureKeysRequest is the body shape accepted by the configure-keys
// endpoint. Empty `key` clears a previously-configured BYOK key.
type ConfigureKeysRequest struct {
	Provider string `json:"provider"`
	Key      string `json:"key"`
}

// ConfigureKeysResponse summarizes the action taken.
type ConfigureKeysResponse struct {
	Provider string `json:"provider"`
	Stored   bool   `json:"stored"`
	Source   string `json:"source"` // "byok-session" or "rejected"
	Message  string `json:"message,omitempty"`
}

// sessionKeyStore holds BYOK keys received from the editor for the current
// process lifetime. Cleared on server restart.
type sessionKeyStore struct {
	mu   sync.RWMutex
	keys map[string]string
}

var sessionStore = &sessionKeyStore{keys: make(map[string]string)}

// GetSessionKey returns a stored BYOK key for the given provider, or the
// empty string if none is set. Read by provider client helpers via the
// `LookupKey` helper below so the env-first precedence rule is honored
// consistently.
func (s *sessionKeyStore) get(provider string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.keys[provider]
}

func (s *sessionKeyStore) set(provider, key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if key == "" {
		delete(s.keys, provider)
		return
	}
	s.keys[provider] = key
}

// LookupKey resolves a provider key for the current request. Env-supplied
// keys always win; the BYOK session store is the fallback. The `byokKey`
// argument is the value of the `X-BYOK-Key` header forwarded by the editor
// for the request — when present and not overridden by env, it takes
// precedence over the session store so per-request keys work for cases
// where the editor doesn't want to call /ConfigureKeys first.
func LookupKey(provider string, envVars []string, byokKey string) (key, source string) {
	for _, v := range envVars {
		if value := os.Getenv(v); value != "" {
			return value, "env"
		}
	}
	if byokKey != "" {
		return byokKey, "byok-header"
	}
	if stored := sessionStore.get(provider); stored != "" {
		return stored, "byok-session"
	}
	return "", ""
}

func init() {
	serverContext.Handle(http.MethodPost, "/api/AI/ConfigureKeys", ConfigureKeysHandler, constants.None)
}

// ConfigureKeysHandler accepts a BYOK provider key for the current server
// session. Env-supplied keys still take precedence over keys configured here.
func ConfigureKeysHandler(w http.ResponseWriter, r *http.Request) {
	var req ConfigureKeysRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ConfigureKeysResponse{
			Source:  "rejected",
			Message: "invalid request body",
		})
		return
	}

	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		writeJSON(w, http.StatusBadRequest, ConfigureKeysResponse{
			Source:  "rejected",
			Message: "provider is required",
		})
		return
	}

	if _, known := providerEnvVars[provider]; !known {
		writeJSON(w, http.StatusBadRequest, ConfigureKeysResponse{
			Provider: provider,
			Source:   "rejected",
			Message:  "unknown provider",
		})
		return
	}

	sessionStore.set(provider, strings.TrimSpace(req.Key))

	writeJSON(w, http.StatusOK, ConfigureKeysResponse{
		Provider: provider,
		Stored:   req.Key != "",
		Source:   "byok-session",
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
