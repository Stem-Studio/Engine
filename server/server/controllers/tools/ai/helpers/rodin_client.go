// Package helpers provides API clients for various AI services.
package helpers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/byok"
)

// Re-exported for backward compatibility / parity with the other clients.
const RodinAPIBaseURLExport = RodinAPIBaseURL

// rodinTaskIDSeparator joins the two identifiers Rodin needs across its task
// lifecycle into the single `task_id` string the rest of the stack passes
// around: the task uuid (used to download outputs) and the subscription key
// (used to poll status). Format: "<task_uuid>|<subscription_key>".
const rodinTaskIDSeparator = "|"

// NewRodinClientWithBaseURL creates a Rodin client with a custom base URL using
// the env var key. Primarily used by tests to point at an httptest server.
func NewRodinClientWithBaseURL(baseURL string) (*RodinClient, error) {
	return NewRodinClientWithBaseURLAndKey(baseURL, "")
}

// NewRodinClientWithBaseURLAndKey creates a Rodin client with a custom base
// URL, honoring BYOK precedence (env > per-request byokKey > session store).
func NewRodinClientWithBaseURLAndKey(baseURL, byokKey string) (*RodinClient, error) {
	apiKey, _ := byok.LookupKey("rodin", []string{"RODIN_API_KEY", "HYPER3D_API_KEY"}, byokKey)
	if apiKey == "" {
		return nil, fmt.Errorf("Rodin API key not set")
	}
	return &RodinClient{
		apiKey:  apiKey,
		baseURL: baseURL,
	}, nil
}

// EncodeRodinTaskID packs the task uuid and subscription key into the composite
// id carried through the generation/polling flow.
func EncodeRodinTaskID(taskUUID, subscriptionKey string) string {
	return taskUUID + rodinTaskIDSeparator + subscriptionKey
}

// DecodeRodinTaskID splits a composite Rodin task id back into the task uuid and
// subscription key. A missing separator yields an empty subscription key, which
// callers treat as an error.
func DecodeRodinTaskID(taskID string) (taskUUID, subscriptionKey string) {
	parts := strings.SplitN(taskID, rodinTaskIDSeparator, 2)
	taskUUID = parts[0]
	if len(parts) == 2 {
		subscriptionKey = parts[1]
	}
	return taskUUID, subscriptionKey
}

// RodinMakeRequest sends a JSON API request to Rodin (used for /status and
// /download — task creation uses RodinCreateTask, which is multipart).
func RodinMakeRequest(c *RodinClient, method, endpoint string, payload interface{}) (*http.Response, error) {
	var body io.Reader

	if payload != nil {
		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("error encoding request payload: %w", err)
		}
		body = bytes.NewReader(payloadBytes)
	}

	url := fmt.Sprintf("%s%s", c.baseURL, endpoint)
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{}
	return client.Do(req)
}

// RodinCreateTask submits a generation task to `POST /rodin`. Rodin expects
// multipart/form-data even for text-only prompts; `fields` carries the string
// form values (prompt, tier, quality, geometry_file_format, material, ...).
// Returns the task uuid and subscription key used to poll and download.
func RodinCreateTask(c *RodinClient, fields map[string]string) (taskUUID, subscriptionKey string, err error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for k, v := range fields {
		if v == "" {
			continue
		}
		if writeErr := writer.WriteField(k, v); writeErr != nil {
			return "", "", fmt.Errorf("error encoding form field %q: %w", k, writeErr)
		}
	}
	if closeErr := writer.Close(); closeErr != nil {
		return "", "", fmt.Errorf("error finalizing multipart body: %w", closeErr)
	}

	url := fmt.Sprintf("%s/rodin", c.baseURL)
	req, reqErr := http.NewRequest(http.MethodPost, url, &buf)
	if reqErr != nil {
		return "", "", fmt.Errorf("error creating request: %w", reqErr)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	client := &http.Client{}
	resp, doErr := client.Do(req)
	if doErr != nil {
		return "", "", fmt.Errorf("error sending request: %w", doErr)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", "", fmt.Errorf("rodin task creation failed (status %d): %s", resp.StatusCode, string(snippet))
	}

	var submit RodinSubmitResponse
	if decodeErr := json.NewDecoder(resp.Body).Decode(&submit); decodeErr != nil {
		return "", "", fmt.Errorf("failed to parse response: %w", decodeErr)
	}
	if submit.Error != "" {
		return "", "", fmt.Errorf("rodin task creation error: %s", submit.Error)
	}
	if submit.UUID == "" || submit.Jobs.SubscriptionKey == "" {
		return "", "", fmt.Errorf("rodin task creation returned no task uuid / subscription key")
	}
	return submit.UUID, submit.Jobs.SubscriptionKey, nil
}

// RodinFetchTask polls a Rodin task's status and, once complete, resolves the
// GLB download URL. It normalizes Rodin's per-job status vocabulary into the
// unified status set the frontend poller understands
// (completed / processing / failed).
func RodinFetchTask(c *RodinClient, taskID string) (*UnifiedTaskResponse, error) {
	taskUUID, subscriptionKey := DecodeRodinTaskID(taskID)
	if subscriptionKey == "" {
		return nil, fmt.Errorf("invalid rodin task id (missing subscription key): %q", taskID)
	}

	resp, err := RodinMakeRequest(c, http.MethodPost, "/status", map[string]string{
		"subscription_key": subscriptionKey,
	})
	if err != nil {
		return nil, fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch task status, status code: %d", resp.StatusCode)
	}

	var status RodinStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	unifiedStatus, progress := summarizeRodinJobs(status.Jobs)
	result := &UnifiedTaskResponse{
		ID:       taskID,
		Status:   unifiedStatus,
		Progress: progress,
	}
	if status.Error != "" {
		result.Error = status.Error
	}

	// Only resolve the download URL once every job is done — Rodin's /download
	// returns nothing useful before then.
	if unifiedStatus == "completed" {
		model, dlErr := rodinDownloadModelURL(c, taskUUID)
		if dlErr != nil {
			return nil, dlErr
		}
		result.Model = model
	}

	return result, nil
}

// summarizeRodinJobs collapses Rodin's per-job statuses into one unified status
// plus a 0-100 progress estimate. Any failed job fails the task; the task is
// complete only when every job is done.
func summarizeRodinJobs(jobs []struct {
	UUID   string `json:"uuid"`
	Status string `json:"status"`
}) (status string, progress int) {
	if len(jobs) == 0 {
		// No jobs yet — treat as still queued rather than complete.
		return "processing", 0
	}

	done := 0
	for _, job := range jobs {
		switch strings.ToLower(strings.TrimSpace(job.Status)) {
		case "done", "succeeded", "success", "completed":
			done++
		case "failed", "error", "canceled", "cancelled":
			return "failed", 0
		}
	}

	progress = done * 100 / len(jobs)
	if done == len(jobs) {
		return "completed", 100
	}
	return "processing", progress
}

// rodinDownloadModelURL fetches the task's output file list and selects a GLB
// (falling back to GLTF). Other formats are rejected rather than imported
// through an unverified path.
func rodinDownloadModelURL(c *RodinClient, taskUUID string) (string, error) {
	resp, err := RodinMakeRequest(c, http.MethodPost, "/download", map[string]string{
		"task_uuid": taskUUID,
	})
	if err != nil {
		return "", fmt.Errorf("error requesting download list: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to fetch download list, status code: %d", resp.StatusCode)
	}

	var download RodinDownloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&download); err != nil {
		return "", fmt.Errorf("failed to parse download response: %w", err)
	}
	if download.Error != "" {
		return "", fmt.Errorf("rodin download error: %s", download.Error)
	}

	model := selectRodinModelURL(download.List)
	if model == "" {
		return "", fmt.Errorf("rodin task produced no GLB/GLTF output")
	}
	return model, nil
}

// selectRodinModelURL prefers a GLB output, then GLTF. The name match is on the
// file extension so signed-URL query strings don't interfere.
func selectRodinModelURL(list []struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}) string {
	var gltf string
	for _, f := range list {
		name := strings.ToLower(f.Name)
		switch {
		case strings.HasSuffix(name, ".glb"):
			return f.URL
		case strings.HasSuffix(name, ".gltf") && gltf == "":
			gltf = f.URL
		}
	}
	return gltf
}
