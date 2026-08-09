package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/helpers"
	"go.mongodb.org/mongo-driver/bson"
)

// SearchModelsRequest represents the request structure for model search
type SearchModelsRequest struct {
	UserQuery  string `json:"userQuery"`
	AIProvider string `json:"aiProvider,omitempty"` // Optional aiProvider selection
	Provider   string `json:"provider,omitempty"`   // Optional provider selection (local, polyhaven, sketchfab, meshy)
}

// AssetResult represents a single asset result
type AssetResult struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Provider    string   `json:"provider"`
	AssetType   string   `json:"assetType"`
	PreviewURL  string   `json:"previewUrl"`
	DownloadURL string   `json:"downloadUrl"`
	Tags        []string `json:"tags"`
	License     string   `json:"license"`
	Category    string   `json:"category"`
}

// SearchModelsResponse represents the response structure for model search
type SearchModelsResponse struct {
	Success bool          `json:"success"`
	Message string        `json:"message"`
	Assets  []AssetResult `json:"assets"`
	Query   string        `json:"query"`
}

type MeshModel struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Tags      []string `json:"tags"`
	URL       string   `json:"url"`
	Thumbnail string   `json:"thumbnail"`
}

func init() {
	serverContext.Handle(http.MethodPost, "/api/AI/SearchAssets", SearchModelsHandler, constants.User)
}

func SearchModelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithSearchJSON(w, http.StatusMethodNotAllowed, SearchModelsResponse{
			Success: false,
			Message: "Invalid request method",
			Assets:  []AssetResult{},
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Parse request data
	var requestData SearchModelsRequest
	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		respondWithSearchJSON(w, http.StatusBadRequest, SearchModelsResponse{
			Success: false,
			Message: "Invalid JSON data",
			Assets:  []AssetResult{},
		})
		return
	}

	if requestData.UserQuery == "" {
		respondWithSearchJSON(w, http.StatusBadRequest, SearchModelsResponse{
			Success: false,
			Message: "User query is required",
			Assets:  []AssetResult{},
		})
		return
	}

	// Determine which provider to use for AI decision making
	aiProviderType := helpers.ProviderOpenAI // Default to OpenAI
	if requestData.AIProvider != "" {
		switch requestData.AIProvider {
		case "claude":
			aiProviderType = helpers.ProviderClaude
		case "gemini":
			aiProviderType = helpers.ProviderGemini
		}
	} else {
		// Check if there's a default provider set in environment
		defaultProvider := os.Getenv("DEFAULT_LLM_PROVIDER")
		if defaultProvider != "" {
			switch defaultProvider {
			case "claude":
				aiProviderType = helpers.ProviderClaude
			case "gemini":
				aiProviderType = helpers.ProviderGemini
			}
		}
	}

	// Generate asset search parameters using AI
	searchParams, err := helpers.GenerateAssetSearchParams(r.Context(), requestData.UserQuery, aiProviderType)

	fmt.Println("Generated search parameters:", searchParams)
	if err != nil {
		respondWithSearchJSON(w, http.StatusInternalServerError, SearchModelsResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to generate search parameters: %v", err),
			Assets:  []AssetResult{},
			Query:   requestData.UserQuery,
		})
		return
	}

	// Check if search is required
	if !searchParams.SearchRequired {
		respondWithSearchJSON(w, http.StatusOK, SearchModelsResponse{
			Success: true,
			Message: "No asset search required for this query",
			Assets:  []AssetResult{},
			Query:   requestData.UserQuery,
		})
		return
	}

	// If source is specified, override providers order for all searches
	if requestData.Provider != "" {
		validProviders := map[string]bool{
			"local":     true,
			"polyhaven": true,
			"sketchfab": true,
			"meshy":     true,
		}

		if !validProviders[requestData.Provider] {
			respondWithSearchJSON(w, http.StatusBadRequest, SearchModelsResponse{
				Success: false,
				Message: fmt.Sprintf("Invalid provider: %s. Valid providers are: local, polyhaven, sketchfab, meshy", requestData.Provider),
				Assets:  []AssetResult{},
				Query:   requestData.UserQuery,
			})
			return
		}

		// Override providers order for all searches to use only the specified source
		for i := range searchParams.Searches {
			searchParams.Searches[i].ProvidersOrder = []string{requestData.Provider}
		}
	}

	// Perform searches for each search item
	var allAssets []AssetResult
	var searchMessages []string

	for _, searchItem := range searchParams.Searches {
		assets, message := performAssetSearch(r.Context(), searchItem)
		allAssets = append(allAssets, assets...)
		if message != "" {
			searchMessages = append(searchMessages, message)
		}
	}

	// Prepare response
	var responseMessage string
	if len(allAssets) == 0 {
		if len(searchMessages) > 0 {
			responseMessage = fmt.Sprintf("No assets found. %s", searchMessages[0])
		} else {
			responseMessage = "No assets found for the given query"
		}
	} else {
		responseMessage = fmt.Sprintf("Found %d assets", len(allAssets))
	}

	respondWithSearchJSON(w, http.StatusOK, SearchModelsResponse{
		Success: true,
		Message: responseMessage,
		Assets:  allAssets,
		Query:   requestData.UserQuery,
	})
}

// performAssetSearch performs the actual asset search for a single search item
func performAssetSearch(ctx context.Context, searchItem helpers.AssetSearchItem) ([]AssetResult, string) {
	var allAssets []AssetResult
	var lastError string

	// Search each provider in the specified order
	for _, provider := range searchItem.ProvidersOrder {
		switch provider {
		case "local":
			assets, err := searchLocalAssets(ctx, searchItem)
			if err != nil {
				lastError = fmt.Sprintf("Local search failed: %v", err)
				continue
			}
			allAssets = append(allAssets, assets...)

		case "polyhaven":
			assets, err := searchPolyHavenAssets(ctx, searchItem)
			if err != nil {
				lastError = fmt.Sprintf("PolyHaven search failed: %v", err)
				continue
			}
			allAssets = append(allAssets, assets...)

		case "sketchfab":
			assets, err := searchSketchfabAssets(ctx, searchItem)
			if err != nil {
				lastError = fmt.Sprintf("Sketchfab search failed: %v", err)
				continue
			}
			allAssets = append(allAssets, assets...)

		case "meshy":
			assets, err := searchMeshyAssets(ctx, searchItem)
			if err != nil {
				lastError = fmt.Sprintf("meshy search failed: %v", err)
				continue
			}
			allAssets = append(allAssets, assets...)
		}

		// If we found assets, we can stop searching other providers
		// (unless we want to combine results from multiple providers)
		if len(allAssets) > 0 {
			break
		}
	}

	return allAssets, lastError
}

// searchLocalAssets searches local mesh database for assets based on tags
func searchLocalAssets(ctx context.Context, searchItem helpers.AssetSearchItem) ([]AssetResult, error) {
	if searchItem.AssetType != "models" {
		return []AssetResult{}, nil // Local search only supports models
	}

	db, err := serverContext.Mongo()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Use the generated tags for searching
	phrases := searchItem.Tags
	if len(phrases) == 0 {
		return []AssetResult{}, nil
	}

	// Search by tags using the same logic as handle_search.go
	tagFilter := bson.M{
		"Tags": bson.M{
			"$in": phrases,
		},
	}

	var tagResults []MeshModel
	err = db.FindMany(constants.MeshCollectionName, tagFilter, &tagResults)
	if err != nil {
		return nil, fmt.Errorf("failed to search meshes: %w", err)
	}

	// Filter tag results to ensure at least half of the tags match the phrases
	type TaggedModel struct {
		MeshModel
		MatchingTags int
	}

	var taggedResults []TaggedModel
	for _, result := range tagResults {
		matchingTags := 0
		for _, tag := range result.Tags {
			for _, phrase := range phrases {
				if strings.EqualFold(tag, phrase) {
					matchingTags++
					break
				}
			}
		}

		if matchingTags > 0 && (len(result.Tags) == 1 || matchingTags >= len(result.Tags)/3) {
			taggedResults = append(taggedResults, TaggedModel{MeshModel: result, MatchingTags: matchingTags})
		}
	}

	// Sort the results by the number of matching tags in descending order
	sort.Slice(taggedResults, func(i, j int) bool {
		return taggedResults[i].MatchingTags > taggedResults[j].MatchingTags
	})

	// Convert to AssetResult format and limit to 10 results
	var assets []AssetResult
	maxResults := 10
	if len(taggedResults) < maxResults {
		maxResults = len(taggedResults)
	}

	for i := 0; i < maxResults; i++ {
		model := taggedResults[i].MeshModel
		assetResult := AssetResult{
			ID:          model.ID,
			Name:        model.Name,
			Provider:    "local",
			AssetType:   "models",
			DownloadURL: model.URL,
			Tags:        model.Tags,
			License:     "Local Asset",
			Category:    "Local Models",
			PreviewURL:  model.Thumbnail,
		}
		assets = append(assets, assetResult)
	}

	fmt.Printf("Local search found %d assets\n", len(assets))
	return assets, nil
}

// searchPolyHavenAssets searches PolyHaven for assets
func searchPolyHavenAssets(ctx context.Context, searchItem helpers.AssetSearchItem) ([]AssetResult, error) {
	client := helpers.NewPolyHavenClient()

	availableCategories, err := client.GetAvailableCategories(ctx, searchItem.AssetType)
	if err != nil {
		return nil, fmt.Errorf("failed to get available categories: %w", err)
	}

	// Determine which provider to use for AI decision making
	aiProviderType := helpers.ProviderOpenAI // Default to OpenAI
	// Check if there's a default provider set in environment
	defaultProvider := os.Getenv("DEFAULT_LLM_PROVIDER")
	if defaultProvider != "" {
		switch defaultProvider {
		case "claude":
			aiProviderType = helpers.ProviderClaude
		case "gemini":
			aiProviderType = helpers.ProviderGemini
		}
	}

	selectedCategories := helpers.ChooseCategoriesForSearch(ctx, aiProviderType, searchItem.SearchQuery, availableCategories)
	// Limit results to 5 per search
	result, err := client.SearchAssets(ctx, searchItem.SearchQuery, searchItem.AssetType, selectedCategories, 10)
	if err != nil {
		return nil, err
	}

	var assets []AssetResult
	for _, asset := range result.Assets {
		assetResult := AssetResult{
			ID:          asset.ID,
			Name:        asset.Name,
			Description: asset.Description,
			Provider:    "polyhaven",
			AssetType:   searchItem.AssetType,
			PreviewURL:  asset.Preview,
			Tags:        asset.Tags,
			License:     "CC0", // PolyHaven uses CC0 license
			Category:    asset.Category,
		}

		// Get download URL from files
		if len(asset.Files) > 0 {
			for _, file := range asset.Files {
				assetResult.DownloadURL = file.URL
				break // Use first available file
			}
		}

		assets = append(assets, assetResult)
	}

	return assets, nil
}

// searchSketchfabAssets searches Sketchfab for assets
func searchSketchfabAssets(ctx context.Context, searchItem helpers.AssetSearchItem) ([]AssetResult, error) {
	client := helpers.NewSketchfabClient()

	// Configure search options for Sketchfab
	options := helpers.SketchfabSearchOptions{
		Downloadable: true, // Only downloadable models
		Count:        10,   // Limit results
		Animated:     searchItem.Animated,
	}

	result, err := client.SearchModels(ctx, searchItem.SearchQuery, options)

	if (err != nil || len(result.Results) == 0) && options.Animated {
		// Retry without the Animated field
		fmt.Println("Retrying Sketchfab search without animated models")
		options = helpers.SketchfabSearchOptions{
			Downloadable: true,
			Count:        10,
		}
		result, err = client.SearchModels(ctx, searchItem.SearchQuery, options)
	}

	if err != nil {
		return nil, err
	}

	var assets []AssetResult
	for _, model := range result.Results {
		downloadURL, _ := client.GetModelDownloadURL(ctx, model.UID)
		assetResult := AssetResult{
			ID:          model.UID,
			Name:        model.Name,
			Description: model.Description,
			DownloadURL: downloadURL,
			Provider:    "sketchfab",
			AssetType:   "models",       // Sketchfab only has models
			Category:    model.Category, // Use first category
			PreviewURL:  model.Thumbnails.Images[0].URL,
		}

		assets = append(assets, assetResult)
	}

	return assets, nil
}

// searchMeshyAssets searches Meshy AI for assets
func searchMeshyAssets(ctx context.Context, searchItem helpers.AssetSearchItem) ([]AssetResult, error) {
	client, err := helpers.NewMeshyClientWithBaseURL("https://api.meshy.ai/openapi/v2")
	if err != nil {
		log.Printf("❌ [Meshy] Failed to create client: %v\n", err)

		return nil, fmt.Errorf("failed to create Meshy client: %w", err)
	}

	// 1. Create a new task (Text-to-3D)
	createPayload := map[string]interface{}{
		"mode":   "preview",
		"prompt": searchItem.SearchQuery,
		"style":  "realistic",
	}
	log.Printf("📤 [Meshy] Sending request to /text-to-3d with payload: %+v", createPayload)
	resp, err := helpers.MeshyMakeRequest(client, "POST", "/text-to-3d", createPayload)
	if err != nil {
		log.Printf("❌ [Meshy] MeshyMakeRequest failed: %v", err)

		return nil, fmt.Errorf("failed to create meshy task: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("📥 [Meshy] Response status: %d", resp.StatusCode)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ [Meshy] Task creation failed, body: %s", string(body))

		return nil, fmt.Errorf("failed to create task, status code: %d, body: %s", resp.StatusCode, string(body))
	}

	// 2️. get the result (just model ID)
	var taskResp struct {
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&taskResp); err != nil {
		log.Printf("❌ [Meshy] Failed to decode creation response: %v", err)

		return nil, fmt.Errorf("failed to parse task creation response: %w", err)
	}

	if taskResp.Result == "" {
		log.Println("❌ [Meshy] API did not return a task result ID")

		return nil, fmt.Errorf("Meshy did not return a task result ID")
	}
	log.Printf("✅ [Meshy] Task created successfully with ID: %s", taskResp.Result)
	log.Println("⏳ [Meshy] Waiting for task to complete...")

	// 3. wait for task to finish
	taskResult, err := helpers.MeshyWaitForTask(client, taskResp.Result, 5*time.Second, 10*time.Minute)

	if err != nil {
		log.Printf("❌ [Meshy] Task failed or timed out: %v", err)

		return nil, fmt.Errorf("meshy task failed: %w", err)
	}
	log.Printf("✅ [Meshy] Task completed successfully:\nID: %s\nStatus: %s\nModel: %s\nThumbnail: %s",
		taskResult.ID, taskResult.Status, taskResult.Model, taskResult.Thumbnail)

	// 4. create AssetResult with the task result
	asset := AssetResult{
		ID:          taskResult.ID,
		Name:        searchItem.SearchQuery,
		Description: "Generated 3D model from Meshy AI",
		Provider:    "meshy",
		AssetType:   "models",
		DownloadURL: taskResult.Model,
		PreviewURL:  taskResult.Thumbnail,
		Tags:        []string{},
		License:     "Provider Terms",
		Category:    "Generated",
	}
	log.Println("🏁 [Meshy] Returning generated asset successfully.")

	return []AssetResult{asset}, nil
}

// respondWithSearchJSON sends a JSON response for search endpoints
func respondWithSearchJSON(w http.ResponseWriter, status int, response SearchModelsResponse) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode JSON response", http.StatusInternalServerError)
	}
}
