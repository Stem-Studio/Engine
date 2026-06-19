package helpers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEncodeDecodeRodinTaskID(t *testing.T) {
	id := EncodeRodinTaskID("task-uuid-123", "sub-key-456")
	if id != "task-uuid-123|sub-key-456" {
		t.Fatalf("EncodeRodinTaskID = %q, want %q", id, "task-uuid-123|sub-key-456")
	}
	gotUUID, gotKey := DecodeRodinTaskID(id)
	if gotUUID != "task-uuid-123" || gotKey != "sub-key-456" {
		t.Fatalf("DecodeRodinTaskID = (%q, %q), want (task-uuid-123, sub-key-456)", gotUUID, gotKey)
	}

	// A bare uuid with no separator must yield an empty subscription key so
	// callers can reject it rather than poll with a blank key.
	uuidOnly, key := DecodeRodinTaskID("task-uuid-only")
	if uuidOnly != "task-uuid-only" || key != "" {
		t.Fatalf("DecodeRodinTaskID(bare) = (%q, %q), want (task-uuid-only, \"\")", uuidOnly, key)
	}
}

func TestSelectRodinModelURLPrefersGLB(t *testing.T) {
	list := []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}{
		{Name: "model.obj", URL: "https://cdn/model.obj"},
		{Name: "model.gltf", URL: "https://cdn/model.gltf"},
		{Name: "model.glb", URL: "https://cdn/model.glb?sig=abc"},
	}
	if got := selectRodinModelURL(list); got != "https://cdn/model.glb?sig=abc" {
		t.Fatalf("selectRodinModelURL = %q, want the GLB url", got)
	}

	// GLTF fallback when no GLB is present.
	gltfOnly := list[:2]
	if got := selectRodinModelURL(gltfOnly); got != "https://cdn/model.gltf" {
		t.Fatalf("selectRodinModelURL(gltf only) = %q, want the GLTF url", got)
	}

	// Unsupported-only list yields empty (caller turns this into an error).
	objOnly := list[:1]
	if got := selectRodinModelURL(objOnly); got != "" {
		t.Fatalf("selectRodinModelURL(obj only) = %q, want \"\"", got)
	}
}

func TestSummarizeRodinJobs(t *testing.T) {
	type job = struct {
		UUID   string `json:"uuid"`
		Status string `json:"status"`
	}
	cases := []struct {
		name         string
		jobs         []job
		wantStatus   string
		wantProgress int
	}{
		{"empty", nil, "processing", 0},
		{"all done", []job{{Status: "Done"}, {Status: "Done"}}, "completed", 100},
		{"half done", []job{{Status: "Done"}, {Status: "Generating"}}, "processing", 50},
		{"failed", []job{{Status: "Done"}, {Status: "Failed"}}, "failed", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, gotProgress := summarizeRodinJobs(tc.jobs)
			if gotStatus != tc.wantStatus || gotProgress != tc.wantProgress {
				t.Fatalf("summarizeRodinJobs = (%q, %d), want (%q, %d)", gotStatus, gotProgress, tc.wantStatus, tc.wantProgress)
			}
		})
	}
}

// TestRodinFetchTaskCompleted spins up a fake Rodin API and verifies the full
// status -> download resolution, including auth header propagation.
func TestRodinFetchTaskCompleted(t *testing.T) {
	t.Setenv("RODIN_API_KEY", "test-key")

	var statusHits, downloadHits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization header = %q, want %q", got, "Bearer test-key")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			statusHits++
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["subscription_key"] != "sub-key" {
				t.Errorf("status subscription_key = %q, want sub-key", body["subscription_key"])
			}
			json.NewEncoder(w).Encode(RodinStatusResponse{
				Jobs: []struct {
					UUID   string `json:"uuid"`
					Status string `json:"status"`
				}{{UUID: "j1", Status: "Done"}},
			})
		case "/download":
			downloadHits++
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["task_uuid"] != "task-uuid" {
				t.Errorf("download task_uuid = %q, want task-uuid", body["task_uuid"])
			}
			json.NewEncoder(w).Encode(RodinDownloadResponse{
				List: []struct {
					Name string `json:"name"`
					URL  string `json:"url"`
				}{{Name: "result.glb", URL: "https://cdn/result.glb"}},
			})
		default:
			http.Error(w, "unexpected path "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client, err := NewRodinClientWithBaseURL(srv.URL)
	if err != nil {
		t.Fatalf("NewRodinClientWithBaseURL: %v", err)
	}

	res, err := client.FetchTask(EncodeRodinTaskID("task-uuid", "sub-key"))
	if err != nil {
		t.Fatalf("FetchTask: %v", err)
	}
	if res.Status != "completed" || res.Progress != 100 {
		t.Fatalf("FetchTask status = (%q, %d), want (completed, 100)", res.Status, res.Progress)
	}
	if res.Model != "https://cdn/result.glb" {
		t.Fatalf("FetchTask model = %q, want https://cdn/result.glb", res.Model)
	}
	if statusHits != 1 || downloadHits != 1 {
		t.Fatalf("hits status=%d download=%d, want 1/1", statusHits, downloadHits)
	}
}

// TestRodinFetchTaskInProgress confirms the download endpoint is NOT called
// while jobs are still running.
func TestRodinFetchTaskInProgress(t *testing.T) {
	t.Setenv("RODIN_API_KEY", "test-key")

	var downloadHits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			json.NewEncoder(w).Encode(RodinStatusResponse{
				Jobs: []struct {
					UUID   string `json:"uuid"`
					Status string `json:"status"`
				}{{UUID: "j1", Status: "Generating"}},
			})
		case "/download":
			downloadHits++
			http.Error(w, "should not be called", http.StatusBadRequest)
		}
	}))
	defer srv.Close()

	client, err := NewRodinClientWithBaseURL(srv.URL)
	if err != nil {
		t.Fatalf("NewRodinClientWithBaseURL: %v", err)
	}

	res, err := client.FetchTask(EncodeRodinTaskID("task-uuid", "sub-key"))
	if err != nil {
		t.Fatalf("FetchTask: %v", err)
	}
	if res.Status != "processing" || res.Model != "" {
		t.Fatalf("FetchTask = (%q, model=%q), want (processing, \"\")", res.Status, res.Model)
	}
	if downloadHits != 0 {
		t.Fatalf("download called %d times while in progress, want 0", downloadHits)
	}
}

func TestRodinFetchTaskRejectsMissingSubscriptionKey(t *testing.T) {
	t.Setenv("RODIN_API_KEY", "test-key")
	client, err := NewRodinClientWithBaseURL("https://example.invalid")
	if err != nil {
		t.Fatalf("NewRodinClientWithBaseURL: %v", err)
	}
	_, err = client.FetchTask("bare-uuid-no-key")
	if err == nil || !strings.Contains(err.Error(), "subscription key") {
		t.Fatalf("FetchTask(bare) err = %v, want a missing-subscription-key error", err)
	}
}
