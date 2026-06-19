//go:build oss

package object_generation

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/byok"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/helpers"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/userlimits"
)

// RodinGenerateRequest is the normalized text-to-3D request. Image-to-3D is
// deferred until the Rodin upload contract is confirmed, so only `prompt` is
// required here.
type RodinGenerateRequest struct {
	Prompt   string `json:"prompt"`
	Quality  string `json:"quality,omitempty"`  // high | medium | low | extra-low
	Tier     string `json:"tier,omitempty"`     // Regular | Sketch
	Material string `json:"material,omitempty"` // PBR | Shaded
	MeshMode string `json:"mesh_mode,omitempty"`
	Seed     string `json:"seed,omitempty"`
	SceneID  string `json:"sceneId,omitempty"`
	Name     string `json:"name,omitempty"`
}

func init() {
	serverContext.Handle(http.MethodPost, "/api/AI/ObjectGeneration/Rodin/Generate", handleRodinGenerate, constants.User)
}

func handleRodinGenerate(w http.ResponseWriter, r *http.Request) {
	if err := userlimits.Require3D(r); err != nil {
		writeObjectGenerationError(w, err.Error(), http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		writeObjectGenerationError(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	byokKey, _ := byok.ResolveFromRequest(r, "rodin", byok.ProviderEnvVars("rodin")...)
	client, err := helpers.NewRodinClientWithKey(byokKey)
	if err != nil {
		log.Printf("[Rodin] API client initialization failed: %v", err)
		if strings.Contains(err.Error(), "not set") {
			writeObjectGenerationError(w, "AI model generation service is not configured (RODIN_API_KEY missing)", http.StatusServiceUnavailable)
		} else {
			writeObjectGenerationError(w, "AI model generation service initialization failed: "+err.Error(), http.StatusInternalServerError)
		}
		return
	}

	var req RodinGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeObjectGenerationError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		writeObjectGenerationError(w, "A text prompt is required for Rodin generation", http.StatusBadRequest)
		return
	}

	// Defaults tuned for editor use: GLB output (the only format we import),
	// balanced quality, regular tier.
	if req.Quality == "" {
		req.Quality = "medium"
	}
	if req.Tier == "" {
		req.Tier = "Regular"
	}
	if req.Material == "" {
		req.Material = "PBR"
	}

	fields := map[string]string{
		"prompt":               req.Prompt,
		"tier":                 req.Tier,
		"quality":              req.Quality,
		"material":             req.Material,
		"geometry_file_format": "glb",
		"mesh_mode":            req.MeshMode,
		"seed":                 req.Seed,
	}

	taskUUID, subscriptionKey, err := helpers.RodinCreateTask(client, fields)
	if err != nil {
		log.Printf("[Rodin] Task creation failed: %v", err)
		writeObjectGenerationError(w, "AI model generation API error: "+err.Error(), http.StatusBadGateway)
		return
	}

	if err := userlimits.Consume3D(r, 1); err != nil {
		writeObjectGenerationError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"task_id": helpers.EncodeRodinTaskID(taskUUID, subscriptionKey),
	})
}
