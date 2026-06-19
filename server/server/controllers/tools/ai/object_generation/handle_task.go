package object_generation

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/helpers"
)

func init() {
	serverContext.Handle(http.MethodGet, "/api/AI/ObjectGeneration/Task", TaskStatusHandler, constants.None)
}

func TaskStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	taskId := r.URL.Query().Get("taskId")
	generator := r.URL.Query().Get("generator")

	if taskId == "" {
		http.Error(w, "Missing taskId parameter", http.StatusBadRequest)
		return
	}

	var responseBody *helpers.UnifiedTaskResponse
	var err error

	switch generator {
	case "meshy":
		client, clientErr := helpers.NewMeshyClient()
		if clientErr != nil {
			http.Error(w, fmt.Sprintf("Failed to initialize client: %s", clientErr.Error()), http.StatusInternalServerError)
			return
		}
		responseBody, err = client.FetchTask(taskId)
	case "meshy_rig":
		client, clientErr := helpers.NewMeshyClientWithBaseURL("https://api.meshy.ai/openapi/v1")
		if clientErr != nil {
			http.Error(w, fmt.Sprintf("Failed to initialize client: %s", clientErr.Error()), http.StatusInternalServerError)
			return
		}
		rigResponse, rigErr := helpers.MeshyFetchRigTask(client, taskId)
		if rigErr != nil {
			http.Error(w, rigErr.Error(), http.StatusInternalServerError)
			return
		}
		responseBody = &helpers.UnifiedTaskResponse{
			ID:       rigResponse.ID,
			Status:   rigResponse.Status,
			Progress: rigResponse.Progress,
			Model:    rigResponse.Result.RiggedCharacterGLBURL,
		}
	case "tripo":
		client, err := helpers.NewTripoClient()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to initialize client: %s", err.Error()), http.StatusInternalServerError)
			return
		}
		responseBody, err = client.FetchTask(taskId)
	case "rodin":
		client, clientErr := helpers.NewRodinClient()
		if clientErr != nil {
			http.Error(w, fmt.Sprintf("Failed to initialize client: %s", clientErr.Error()), http.StatusInternalServerError)
			return
		}
		responseBody, err = client.FetchTask(taskId)
	case "erth":
		task, exists := getErthTask(taskId)
		if !exists {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(task)
		return
	default:
		http.Error(w, fmt.Sprintf("Unsupported generator: %s", generator), http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(responseBody)
}
