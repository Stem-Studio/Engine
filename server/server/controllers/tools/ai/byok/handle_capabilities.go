package byok

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
)

// ProviderStatus reports whether a given AI provider is configured and how.
type ProviderStatus struct {
	Status string `json:"status"` // "ready" | "missing-key"
	Source string `json:"source"` // "env" | "" when missing
}

// CapabilitiesResponse is the shape returned by the capabilities endpoint.
type CapabilitiesResponse struct {
	BuildMode string                    `json:"buildMode"` // "oss"
	Providers map[string]ProviderStatus `json:"providers"`
}

// providerEnvVars maps each provider key to the env var(s) that configure it.
// If any env var in the list is set, the provider is considered ready.
var providerEnvVars = map[string][]string{
	"anthropic":     {"CLAUDE_API_KEY", "ANTHROPIC_API_KEY"},
	"openai":        {"OPENAI_API_KEY"},
	"meshy":         {"MESHY_API_KEY"},
	"elevenlabs":    {"ELEVEN_LABS_API_KEY", "ELEVENLABS_API_KEY"},
	"anythingworld": {"ANYTHING_WORLD_API_KEY", "ANYTHINGWORLD_API_KEY"},
	"gemini":        {"GEMINI_API_KEY"},
	"tripo":         {"TRIPO_API_KEY"},
	"rodin":         {"RODIN_API_KEY", "HYPER3D_API_KEY"},
}

func init() {
	serverContext.Handle(http.MethodGet, "/api/AI/Capabilities", CapabilitiesHandler, constants.None)
}

// CapabilitiesHandler reports which AI providers are configured on this server.
// Used by the editor to decide which AI features to enable and which to gate
// behind a "configure key" prompt (OSS / BYOK flow).
func CapabilitiesHandler(w http.ResponseWriter, r *http.Request) {
	providers := make(map[string]ProviderStatus, len(providerEnvVars))
	for name, envVars := range providerEnvVars {
		status := ProviderStatus{Status: "missing-key", Source: ""}
		// Env-supplied keys win and report "env".
		for _, v := range envVars {
			if os.Getenv(v) != "" {
				status = ProviderStatus{Status: "ready", Source: "env"}
				break
			}
		}
		// Fall back to the BYOK session store (populated by POST
		// /api/AI/ConfigureKeys). Without this check the editor's
		// Settings panel keeps showing "missing key" after the user
		// configured one, even though subsequent AI requests succeed.
		if status.Status != "ready" && sessionStore.get(name) != "" {
			status = ProviderStatus{Status: "ready", Source: "byok-session"}
		}
		providers[name] = status
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(CapabilitiesResponse{
		BuildMode: "oss",
		Providers: providers,
	})
}
