// Package helpers provides API clients for various AI services.
package helpers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/byok"
)

// This file maintains the original API clients structure for backward compatibility.
// New code should import api_client_interfaces.go and the specific client files.

// The constants, interfaces, and client types are defined in their respective files:
// - api_client_interfaces.go: Contains common interfaces and constants
// - scenario_client.go: Contains Scenario API client implementation
// - tripo_client.go: Contains Tripo API client implementation
// - meshy_client.go: Contains Meshy API client implementation

// API endpoints (re-exported for backward compatibility)
// These constants are now defined in api_client_interfaces.go

// Re-export types and interfaces for backward compatibility
type UnifiedTaskResponse struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"`
	Thumbnail string   `json:"thumbnail"`
	Model     string   `json:"model"`
	Progress  int      `json:"progress"`
	Topology  string   `json:"topology,omitempty"`
	Riggable  bool     `json:"riggable,omitempty"`
	AssetIds  []string `json:"assetIds,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// ScenarioClient defines the client for Scenario API
type ScenarioClient struct {
	apiKey    string
	apiSecret string
	baseURL   string
}

// TripoClient defines the client for Tripo3D API
type TripoClient struct {
	apiKey  string
	baseURL string
}

// MeshyClient defines the client for Meshy API
type MeshyClient struct {
	apiKey  string
	baseURL string
}

// RodinClient defines the client for the Hyper3D Rodin API
type RodinClient struct {
	apiKey  string
	baseURL string
}

// Scenario response type
type ScenarioJobResponse struct {
	Status   string   `json:"status"`
	AssetIds []string `json:"assetIds"`
}

// Tripo response type
type TripoTaskResponse struct {
	Code int `json:"code"`
	Data struct {
		TaskID string `json:"task_id"`
		Type   string `json:"type"`
		Status string `json:"status"`
		Input  struct {
			Prompt string `json:"prompt"`
		} `json:"input"`
		Output struct {
			Model         string `json:"model,omitempty"`
			BaseModel     string `json:"base_model,omitempty"`
			PBRModel      string `json:"pbr_model,omitempty"`
			RenderedImage string `json:"rendered_image,omitempty"`
			Riggable      bool   `json:"riggable,omitempty"`
			Topology      string `json:"topology,omitempty"`
		} `json:"output"`
		Progress   int   `json:"progress"`
		CreateTime int64 `json:"create_time"`
	} `json:"data"`
}

// Meshy response type
type MeshyTaskResponse struct {
	ID        string `json:"id"`
	Result    string `json:"result"`
	Status    string `json:"status"`
	Progress  int    `json:"progress"`
	ModelURLs struct {
		GLB string `json:"glb"`
	} `json:"model_urls"`
	ThumbnailURL string `json:"thumbnail_url"`
	TaskError    struct {
		Message string `json:"message"`
	} `json:"task_error"`
}

// Rodin response types. Rodin's task lifecycle uses three calls — create
// (`POST /rodin`), poll (`POST /status`), and fetch (`POST /download`) — and
// the poll/fetch steps key off different identifiers (subscription key vs task
// uuid), so the wrapper threads both through a composite task id.

// RodinSubmitResponse is the response from POST /rodin (task creation).
type RodinSubmitResponse struct {
	UUID string `json:"uuid"`
	Jobs struct {
		UUIDs           []string `json:"uuids"`
		SubscriptionKey string   `json:"subscription_key"`
	} `json:"jobs"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// RodinStatusResponse is the response from POST /status.
type RodinStatusResponse struct {
	Jobs []struct {
		UUID   string `json:"uuid"`
		Status string `json:"status"`
	} `json:"jobs"`
	Error string `json:"error,omitempty"`
}

// RodinDownloadResponse is the response from POST /download.
type RodinDownloadResponse struct {
	List []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"list"`
	Error string `json:"error,omitempty"`
}

// API endpoints
const (
	// ScenarioAPIBaseURL is the base URL for Scenario API
	ScenarioAPIBaseURL string = "https://api.cloud.scenario.com/v1"
	// Tripo3dAPIBaseURL is the base URL for Tripo3D API
	Tripo3dAPIBaseURL string = "https://api.tripo3d.ai/v2/openapi"
	// MeshyAPIBaseURL is the base URL for Meshy API
	MeshyAPIBaseURL string = "https://api.meshy.ai/openapi/v2"
	// RodinAPIBaseURL is the base URL for the Hyper3D Rodin API. Overridable at
	// runtime with the RODIN_API_BASE_URL env var (see NewRodinClientWithKey).
	RodinAPIBaseURL string = "https://hyperhuman.deemos.com/api/v2"
)

// APIClient defines a common interface for all API clients
type APIClient interface {
	// MakeRequest makes an HTTP request to the API
	MakeRequest(method, endpoint string, payload interface{}) (*http.Response, error)

	// GetBaseURL returns the base URL for the API
	GetBaseURL() string

	// GetAuthHeader returns the authorization header
	GetAuthHeader() string
}

// TaskStatusClient extends APIClient for APIs that support task status
type TaskStatusClient interface {
	APIClient

	// FetchTask retrieves the status of a task
	FetchTask(taskId string) (*UnifiedTaskResponse, error)
}

// JobStatusClient extends APIClient for APIs that support job status
type JobStatusClient interface {
	APIClient

	// FetchJob retrieves the status of a job
	FetchJob(jobId string) (*ScenarioJobResponse, error)

	// WaitForJob polls for job completion
	WaitForJob(jobId string, interval time.Duration, timeout time.Duration) (*ScenarioJobResponse, error)
}

// NewScenarioClient creates a new client for Scenario API
func NewScenarioClient() (*ScenarioClient, error) {
	apiKey := os.Getenv("SCENARIO_API_KEY")
	apiSecret := os.Getenv("SCENARIO_API_SECRET")

	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("Scenario API credentials not set")
	}

	return &ScenarioClient{
		apiKey:    apiKey,
		apiSecret: apiSecret,
		baseURL:   ScenarioAPIBaseURL,
	}, nil
}

// GetBaseURL returns the base URL for Scenario API
func (c *ScenarioClient) GetBaseURL() string {
	return ScenarioGetBaseURL(c)
}

// GetAuthHeader returns the auth header for Scenario API
func (c *ScenarioClient) GetAuthHeader() string {
	return ScenarioGetAuthHeader(c)
}

// MakeRequest sends an API request to Scenario
func (c *ScenarioClient) MakeRequest(method, endpoint string, payload interface{}) (*http.Response, error) {
	return ScenarioMakeRequest(c, method, endpoint, payload)
}

// FetchJob fetches the status of a job from Scenario
func (c *ScenarioClient) FetchJob(jobId string) (*ScenarioJobResponse, error) {
	return ScenarioFetchJob(c, jobId)
}

// WaitForJob polls for job completion
func (c *ScenarioClient) WaitForJob(jobId string, interval time.Duration, timeout time.Duration) (*ScenarioJobResponse, error) {
	return ScenarioWaitForJob(c, jobId, interval, timeout)
}

// ToUnifiedResponse converts a ScenarioJobResponse to a UnifiedTaskResponse
func (r *ScenarioJobResponse) ToUnifiedResponse() *UnifiedTaskResponse {
	return ScenarioJobToUnifiedResponse(r)
}

// CreateCompletion is not supported by ScenarioClient
func (c *ScenarioClient) CreateCompletion(ctx context.Context, systemContent, userContent string) (string, error) {
	return "", errors.New("CreateCompletion is not supported by ScenarioClient")
}

// CreateCompletionWithHistory is not supported by ScenarioClient
func (c *ScenarioClient) CreateCompletionWithHistory(ctx context.Context, systemContent string, messages []Message) (string, error) {
	return "", errors.New("CreateCompletionWithHistory is not supported by ScenarioClient")
}

// CreateCompletionStream is not supported by ScenarioClient
func (c *ScenarioClient) CreateCompletionStream(ctx context.Context, systemContent string, messages []Message, schema interface{}) (CompletionStream, error) {
	return nil, errors.New("CreateCompletionStream is not supported by ScenarioClient")
}

// GenerateImage is not supported by ScenarioClient
func (c *ScenarioClient) GenerateImage(ctx context.Context, prompt string) (string, error) {
	return "", errors.New("GenerateImage is not supported by ScenarioClient")
}

// RecognizeImage is not supported by ScenarioClient
func (c *ScenarioClient) RecognizeImage(ctx context.Context, prompt string, imageURL string) (string, error) {
	return "", errors.New("RecognizeImage is not supported by ScenarioClient")
}

// NewTripoClient creates a new client for Tripo3D API using the env var.
func NewTripoClient() (*TripoClient, error) {
	return NewTripoClientWithKey("")
}

// NewTripoClientWithKey creates a Tripo client honoring BYOK precedence:
// env var wins, falls back to the per-request `byokKey` (e.g. forwarded from
// `X-BYOK-Key`), then to the session store populated by ConfigureKeys.
func NewTripoClientWithKey(byokKey string) (*TripoClient, error) {
	apiKey, _ := byok.LookupKey("tripo", []string{"TRIPO_API_KEY"}, byokKey)
	if apiKey == "" {
		return nil, fmt.Errorf("Tripo API key not set")
	}
	return &TripoClient{
		apiKey:  apiKey,
		baseURL: Tripo3dAPIBaseURL,
	}, nil
}

// GetBaseURL returns the base URL for Tripo API
func (c *TripoClient) GetBaseURL() string {
	return c.baseURL
}

// GetAuthHeader returns the auth header for Tripo API
func (c *TripoClient) GetAuthHeader() string {
	return fmt.Sprintf("Bearer %s", c.apiKey)
}

// MakeRequest sends an API request to Tripo
func (c *TripoClient) MakeRequest(method, endpoint string, payload interface{}) (*http.Response, error) {
	return TripoMakeRequest(c, method, endpoint, payload)
}

// FetchTask fetches the status of a task from Tripo
func (c *TripoClient) FetchTask(taskId string) (*UnifiedTaskResponse, error) {
	return TripoFetchTask(c, taskId)
}

// WaitForTask polls for task completion
func (c *TripoClient) WaitForTask(taskId string, interval time.Duration, timeout time.Duration) (*UnifiedTaskResponse, error) {
	return TripoWaitForTask(c, taskId, interval, timeout)
}

// NewMeshyClient creates a new client for Meshy API using the env var.
func NewMeshyClient() (*MeshyClient, error) {
	return NewMeshyClientWithKey("")
}

// NewMeshyClientWithKey creates a Meshy client honoring BYOK precedence:
// env var wins, falls back to the per-request `byokKey` (e.g. forwarded from
// `X-BYOK-Key`), then to the session store populated by ConfigureKeys.
func NewMeshyClientWithKey(byokKey string) (*MeshyClient, error) {
	apiKey, _ := byok.LookupKey("meshy", []string{"MESHY_API_KEY"}, byokKey)
	if apiKey == "" {
		return nil, fmt.Errorf("Meshy API key not set")
	}
	return &MeshyClient{
		apiKey:  apiKey,
		baseURL: MeshyAPIBaseURL,
	}, nil
}

// GetBaseURL returns the base URL for Meshy API
func (c *MeshyClient) GetBaseURL() string {
	return c.baseURL
}

// GetAuthHeader returns the auth header for Meshy API
func (c *MeshyClient) GetAuthHeader() string {
	return fmt.Sprintf("Bearer %s", c.apiKey)
}

// MakeRequest sends an API request to Meshy
func (c *MeshyClient) MakeRequest(method, endpoint string, payload interface{}) (*http.Response, error) {
	return MeshyMakeRequest(c, method, endpoint, payload)
}

// FetchTask fetches the status of a task from Meshy
func (c *MeshyClient) FetchTask(taskId string) (*UnifiedTaskResponse, error) {
	return MeshyFetchTask(c, taskId)
}

// WaitForTask polls for task completion
func (c *MeshyClient) WaitForTask(taskId string, interval time.Duration, timeout time.Duration) (*UnifiedTaskResponse, error) {
	return MeshyWaitForTask(c, taskId, interval, timeout)
}

// NewRodinClient creates a new client for the Rodin API using the env var.
func NewRodinClient() (*RodinClient, error) {
	return NewRodinClientWithKey("")
}

// NewRodinClientWithKey creates a Rodin client honoring BYOK precedence:
// env var wins, falls back to the per-request `byokKey` (e.g. forwarded from
// `X-BYOK-Key`), then to the session store populated by ConfigureKeys. The base
// URL can be overridden with RODIN_API_BASE_URL for self-hosted or staging
// endpoints.
func NewRodinClientWithKey(byokKey string) (*RodinClient, error) {
	apiKey, _ := byok.LookupKey("rodin", []string{"RODIN_API_KEY", "HYPER3D_API_KEY"}, byokKey)
	if apiKey == "" {
		return nil, fmt.Errorf("Rodin API key not set")
	}
	baseURL := RodinAPIBaseURL
	if override := os.Getenv("RODIN_API_BASE_URL"); override != "" {
		baseURL = override
	}
	return &RodinClient{
		apiKey:  apiKey,
		baseURL: baseURL,
	}, nil
}

// GetBaseURL returns the base URL for Rodin API
func (c *RodinClient) GetBaseURL() string {
	return c.baseURL
}

// GetAuthHeader returns the auth header for Rodin API
func (c *RodinClient) GetAuthHeader() string {
	return fmt.Sprintf("Bearer %s", c.apiKey)
}

// MakeRequest sends a JSON API request to Rodin
func (c *RodinClient) MakeRequest(method, endpoint string, payload interface{}) (*http.Response, error) {
	return RodinMakeRequest(c, method, endpoint, payload)
}

// FetchTask fetches the status of a task from Rodin, resolving the GLB output
// URL once the task is complete.
func (c *RodinClient) FetchTask(taskId string) (*UnifiedTaskResponse, error) {
	return RodinFetchTask(c, taskId)
}
