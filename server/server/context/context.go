package context

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"firebase.google.com/go/v4/auth"
	"github.com/dimfeld/httptreemux"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/helper"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/logger"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/services/scheduler"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

type RouteKey struct {
	Method string
	Path   string
}

var (
	// The authority that api requires.
	apiAuthorities = map[RouteKey]constants.Authority{}

	// mux maps ajax url to handler.
	Mux *httptreemux.ContextMux = httptreemux.NewContextMux()

	// Config caches all the setting information we get from config.toml.
	Config *helper.ConfigModel
	// ConfigFilePath stores the source config path used at startup.
	ConfigFilePath string
	// Logger saves the running information of the server to a log file.
	// Backed by zap.SugaredLogger (migrated from logrus on 2026-04-22 to
	// drop a redundant logging dependency). Call sites use printf-style
	// methods (Infof / Errorf / Warnf / Debugf / Info / Error / Warn) which
	// are API-compatible on *zap.SugaredLogger.
	//
	// IMPORTANT: DO NOT use Logger.Fatal or Logger.Panic, it may cause the
	// programs exit.
	Logger *zap.SugaredLogger
	// MongoClients is a collection of mongo.
	MongoClients map[string]*helper.Mongo
	// mongoClientsMutex provides thread-safe access to MongoClients
	mongoClientsMutex sync.RWMutex

	// Firebase Authentication Client
	AuthClient *auth.Client
	// FirestoreClient is used to read/write user data in Firestore
	FirestoreClient *firestore.Client

	// Scheduler for async job processing
	Scheduler *scheduler.Scheduler

	// RedisClient is the optional Redis caching client (nil if unavailable)
	RedisClient *helper.Redis
)

// Create create the server context, such as Config and Logger.
func Create(path string) error {
	// parse ConfigModel
	config, err := helper.GetConfig(path)
	if err != nil {
		return err
	}
	if err := godotenv.Load(); err != nil {
		// Log the error but continue execution - use structured logging after logger is initialized
		logger.GetLogger().Warn("Error loading .env file",
			zap.Error(err),
			zap.String("operation", "server_startup"),
		)
	}

	Config = config
	ConfigFilePath = path
	// Set the global config for helper functions
	helper.SetGlobalConfig(config)
	// create context Logger
	Logger = helper.InitializeLogger(config)

	Logger.Infof("Open-source server: skipping Firebase initialization")
	Mux.OptionsHandler = CorsHandler

	Logger.Infof("Open-source server: skipping MongoDB-backed startup work (api mappings, migrations, indexes)")

	// Initialize async job scheduler
	Scheduler = scheduler.New(scheduler.NewMemoryStore(), scheduler.DefaultConfig())
	Scheduler.Start()
	Logger.Info("Async job scheduler initialized")

	// Initialize Redis client (opt-in via REDIS_ENABLED env var)
	redisEnabled := os.Getenv("REDIS_ENABLED")
	if redisEnabled == "true" || redisEnabled == "1" {
		addr := os.Getenv("REDIS_ADDRESS")
		if addr == "" {
			addr = config.Redis.Address
		}
		if addr == "" {
			addr = "127.0.0.1:6379"
		}
		r := helper.Redis{}
		client, redisErr := r.Create(addr, config.Redis.DB)
		if redisErr != nil {
			logger.GetLogger().Warn("Redis unavailable, caching disabled",
				zap.Error(redisErr),
				zap.String("address", addr),
			)
		} else {
			RedisClient = client
			logger.GetLogger().Info("Redis connected",
				zap.String("address", addr),
			)
		}
	}

	return nil
}

func GetParams(r *http.Request) map[string]string {
	return httptreemux.ContextParams(r.Context())
}

// Mongo create a new mongo client.
// DO NOT call `db.Disconnect()` because of singleton.
func Mongo() (*helper.Mongo, error) {
	return MongoByName(Config.Database.Database)
}

// MongoByName create a new mongo client with name.
// DO NOT call `db.Disconnect()` because of singleton.
func MongoByName(name string) (*helper.Mongo, error) {
	if Config == nil {
		return nil, fmt.Errorf("config is not initialized")
	}

	// First check with read lock (fast path)
	mongoClientsMutex.RLock()
	if MongoClients != nil {
		client, ok := MongoClients[name]
		mongoClientsMutex.RUnlock()
		if ok {
			return client, nil
		}
	} else {
		mongoClientsMutex.RUnlock()
	}

	// If client not found, acquire write lock (slow path)
	mongoClientsMutex.Lock()
	defer mongoClientsMutex.Unlock()

	// Double-check after acquiring write lock
	if MongoClients == nil {
		MongoClients = make(map[string]*helper.Mongo)
	} else {
		// Check again in case another goroutine created the client
		if client, ok := MongoClients[name]; ok {
			return client, nil
		}
	}

	// Create new client
	var err error
	client, err := helper.NewMongo(Config.Database.Connection, name)
	if err != nil && Logger != nil {
		Logger.Error(err)
	}
	MongoClients[name] = client
	return client, err
}

// MapPath maps a relative path to a physical absolute path. The root path `/` means
// the public_dir in config.toml. Empty path is equal to the root path.
func MapPath(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	path = filepath.Join(Config.Path.PublicDir, path)
	return strings.ReplaceAll(path, "/", string(filepath.Separator))
}

// corsHandler handles OPTIONS ajax when cross origin.
func CorsHandler(w http.ResponseWriter, r *http.Request, params map[string]string) {
	helper.EnableCrossDomain(w, r)
}

func matchTemplate(template, path string) bool {
	templateParts := strings.Split(template, "/")
	pathParts := strings.Split(path, "/")

	if len(templateParts) != len(pathParts) {
		return false
	}

	for i := 0; i < len(templateParts); i++ {
		if strings.HasPrefix(templateParts[i], ":") {
			// Template param, skip
			continue
		}
		if templateParts[i] != pathParts[i] {
			return false
		}
	}
	return true
}

func GetAPIAuthority(method, path string) (constants.Authority, bool) {
	// Exact match
	key := RouteKey{Method: method, Path: path}
	if auth, ok := apiAuthorities[key]; ok {
		return auth, true
	}

	// Wildcard match
	for key, auth := range apiAuthorities {
		if key.Method != method {
			continue
		}
		template := key.Path
		if matchTemplate(template, path) {
			return auth, true
		}
	}
	return constants.Authority(""), false
}

// Handle allows handling HTTP requests via an http.HandlerFunc. Authority means the required
// authority to ajax this api. No authority is needed when authority is nil.
func Handle(method, path string, handler http.HandlerFunc, authority constants.Authority) {
	key := RouteKey{Method: method, Path: path}
	if _, ok := apiAuthorities[key]; ok {
		panic(fmt.Errorf("path (%v) has already been added", path))
	}
	apiAuthorities[key] = authority
	Mux.UsingContext().Handle(method, path, handler)
}

func AddUserIdToDocBaseOnRole(r *http.Request, doc bson.M) {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context (constants.None authority)
		return
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	doc["UserID"] = token.UID
}

func UpdateSearchCriteriaBasedOnRole(r *http.Request, filter bson.M, hasIsPublic ...bool) {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context (constants.None authority)
		filter["IsArchived"] = bson.M{"$ne": true}
		if len(hasIsPublic) > 0 && hasIsPublic[0] {
			filter["IsPublic"] = true
		}
		return
	}

	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	authorityForPath := params["authority"].(constants.Authority)

	// Always exclude archived scenes
	filter["IsArchived"] = bson.M{"$ne": true}

	if authorityForPath == constants.None {
		if len(hasIsPublic) > 0 {
			if hasIsPublic[0] {
				filter["IsPublic"] = true
			}
		}
		return
	}

	if !IsAdmin(r) {
		filter["$or"] = bson.A{
			bson.M{"UserID": token.UID},
			bson.M{"UserID": bson.M{"$exists": false}},
			bson.M{"UserID": ""},
		}
		if len(hasIsPublic) > 0 {
			if hasIsPublic[0] {
				filter["$or"] = bson.A{
					bson.M{"UserID": token.UID},
					bson.M{"IsPublic": true},
					bson.M{"UserID": bson.M{"$exists": false}},
					bson.M{"UserID": ""},
				}
			}
		}
	}
}

func UpdateSearchCriteriaBasedOnUser(r *http.Request, filter bson.M, hasIsPublic bool) {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context (constants.None authority)
		filter["IsArchived"] = bson.M{"$ne": true}
		if hasIsPublic {
			filter["IsPublic"] = true
		}
		return
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)

	// Always exclude archived scenes
	filter["IsArchived"] = bson.M{"$ne": true}

	if !hasIsPublic {
		filter = bson.M{"UserID": token.UID}
	} else {
		userFilter := bson.M{"UserID": token.UID}
		publicFilter := bson.M{"IsPublic": true}

		filter["$or"] = bson.A{userFilter, publicFilter}
	}
}

func SearchFilterForID(r *http.Request, id interface{}) (bson.M, options.FindOptions) {

	opts := options.FindOptions{
		Sort: bson.M{},
	}
	filter := bson.M{}
	if id != nil {
		filter["ID"] = id
	}
	UpdateSearchCriteriaBasedOnRole(r, filter)
	return filter, opts
}

func SearchFilterForAvatar(r *http.Request) bson.M {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context - return filter that matches no avatars
		return bson.M{"IsAvatar": true, "UserID": ""}
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)

	filter := bson.M{
		"IsAvatar": true,
		"UserID":   token.UID,
	}

	return filter
}

func IsAdmin(r *http.Request) bool {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context
		return false
	}
	params := authParams.(map[string]interface{})
	isAdmin := helper.ConvertToBool(params["isAdmin"], false)
	return isAdmin
}

func CheckDocOwner(r *http.Request, document bson.M) bool {
	if IsAdmin(r) {
		return true
	}

	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context - not an owner
		return false
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	userID := document["UserID"]

	if userID == token.UID {
		return true
	}

	return false
}

func GetUserID(r *http.Request) string {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context
		return ""
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	return token.UID
}

// runMigrations runs all database migrations on server startup
func runMigrations() error {
	db, err := Mongo()
	if err != nil {
		return fmt.Errorf("failed to connect to database for migrations: %w", err)
	}

	// Import the game_mapping package to access migration functions
	// This is done through a dynamic import to avoid circular dependencies
	Logger.Info("Running database migrations...")

	// Run game mapping migration
	Logger.Info("Running game mapping migration...")
	if err := runGameMappingMigration(db); err != nil {
		Logger.Errorf("Game mapping migration failed: %v", err)
		return err
	}

	Logger.Info("All migrations completed successfully")
	return nil
}

// runGameMappingMigration is a wrapper to avoid import cycles
func runGameMappingMigration(db *helper.Mongo) error {
	// This will be implemented by importing the migration function
	// For now, we'll define the migration logic inline to avoid circular imports
	return migrateGameMappingsInline(db)
}

// migrateGameMappingsInline is an inline implementation to avoid circular imports
func migrateGameMappingsInline(db *helper.Mongo) error {
	migrationName := "game_mapping_migration_v1"

	// Check if this migration has already been run
	migrationFilter := bson.M{"migration_name": migrationName}
	var migrationRecord bson.M
	migrationExists, _ := db.FindOne("_migrations", migrationFilter, &migrationRecord)
	if migrationExists {
		log.Printf("Migration %s already completed, skipping", migrationName)
		return nil
	}

	log.Printf("====================================")
	log.Printf("STARTING GAME MAPPING MIGRATION")
	log.Printf("====================================")
	log.Printf("This migration creates game mappings for existing scenes.")
	log.Printf("TODO: Remove this migration after it has run on all environments!")
	log.Printf("====================================")

	// First, get all existing game mappings to avoid duplicates
	existingMappings := make(map[string]bool)
	var mappings []bson.M
	err := db.FindMany(constants.GameMappingCollectionName, bson.M{}, &mappings)
	if err != nil {
		log.Printf("Error fetching existing mappings: %v", err)
	} else {
		for _, mapping := range mappings {
			if gameID, ok := mapping["GameID"].(string); ok {
				existingMappings[gameID] = true
			}
		}
	}

	// Find all scenes that don't have archived status and have valid names
	filter := bson.M{
		"IsArchived": bson.M{"$ne": true},
		"Name":       bson.M{"$exists": true, "$nin": []interface{}{"", nil}},
		"UserID":     bson.M{"$exists": true, "$nin": []interface{}{"", nil}},
	}

	var scenes []bson.M
	err = db.FindMany(constants.SceneCollectionName, filter, &scenes)
	if err != nil {
		return fmt.Errorf("failed to find scenes for migration: %w", err)
	}

	log.Printf("Found %d scenes to check for migration", len(scenes))

	migratedCount := 0
	skippedCount := 0

	for _, scene := range scenes {
		sceneID, ok := scene["ID"].(string)
		if !ok {
			log.Printf("Skipping scene with invalid ID: %v", scene["ID"])
			skippedCount++
			continue
		}

		// Skip if mapping already exists
		if existingMappings[sceneID] {
			skippedCount++
			continue
		}

		sceneName, ok := scene["Name"].(string)
		if !ok || sceneName == "" {
			log.Printf("Skipping scene %s with invalid name: %v", sceneID, scene["Name"])
			skippedCount++
			continue
		}

		userID, ok := scene["UserID"].(string)
		if !ok || userID == "" {
			log.Printf("Skipping scene %s with invalid UserID: %v", sceneID, scene["UserID"])
			skippedCount++
			continue
		}

		// Generate a slug from the scene name
		slug := generateSlugFromNameInline(sceneName)

		// Check if slug is valid (simple validation inline)
		if len(slug) < 3 || len(slug) > 63 {
			log.Printf("Skipping scene %s with invalid generated slug: %s", sceneID, slug)
			skippedCount++
			continue
		}

		// Check if slug is already taken
		slugFilter := bson.M{"Slug": slug}
		var existingSlug bson.M
		slugExists, _ := db.FindOne(constants.GameMappingCollectionName, slugFilter, &existingSlug)
		if slugExists {
			// Try adding a suffix to make it unique
			originalSlug := slug
			for i := 1; i <= 100; i++ {
				slug = fmt.Sprintf("%s-%d", originalSlug, i)
				if len(slug) <= 63 {
					slugFilter = bson.M{"Slug": slug}
					slugExists, _ = db.FindOne(constants.GameMappingCollectionName, slugFilter, &existingSlug)
					if !slugExists {
						break
					}
				}
			}
			if slugExists {
				log.Printf("Could not generate unique slug for scene %s, skipping", sceneID)
				skippedCount++
				continue
			}
		}

		// Create new mapping
		now := time.Now()
		mapping := bson.M{
			"GameID":     sceneID,
			"Slug":       slug,
			"owner_id":   userID,
			"created_at": now,
			"updated_at": now,
			"created_by": userID,
		}

		_, err := db.InsertOne(constants.GameMappingCollectionName, mapping)
		if err != nil {
			log.Printf("Failed to create mapping for scene %s: %v", sceneID, err)
			continue
		}

		log.Printf("Created mapping for scene %s: %s -> %s", sceneID, sceneName, slug)
		migratedCount++
	}

	// Record that this migration has been completed
	migrationCompletionRecord := bson.M{
		"migration_name": migrationName,
		"completed_at":   time.Now(),
		"migrated_count": migratedCount,
		"skipped_count":  skippedCount,
		"description":    "Created game mappings for existing scenes that didn't have them",
	}
	_, err = db.InsertOne("_migrations", migrationCompletionRecord)
	if err != nil {
		log.Printf("Warning: Failed to record migration completion: %v", err)
	}

	log.Printf("====================================")
	log.Printf("GAME MAPPING MIGRATION COMPLETED")
	log.Printf("Created %d new mappings, skipped %d scenes", migratedCount, skippedCount)
	log.Printf("TODO: Remove this migration after it has run on all environments!")
	log.Printf("====================================")
	return nil
}

// generateSlugFromNameInline creates a URL-friendly slug from a scene name
func generateSlugFromNameInline(name string) string {
	slug := ""
	for _, char := range name {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			if char >= 'A' && char <= 'Z' {
				slug += string(char + 32) // Convert to lowercase
			} else {
				slug += string(char)
			}
		} else if char == ' ' || char == '_' || char == '.' || char == '-' {
			if len(slug) > 0 && slug[len(slug)-1] != '-' {
				slug += "-"
			}
		}
	}

	// Remove trailing and leading hyphens
	for len(slug) > 0 && slug[len(slug)-1] == '-' {
		slug = slug[:len(slug)-1]
	}
	for len(slug) > 0 && slug[0] == '-' {
		slug = slug[1:]
	}

	if len(slug) > 63 {
		slug = slug[:63]
		for len(slug) > 0 && slug[len(slug)-1] == '-' {
			slug = slug[:len(slug)-1]
		}
	}

	return slug
}
func GetUserEmail(r *http.Request) string {
	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context
		return ""
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	return helper.GetStringFromField(token.Claims, "email", "")
}

func CheckSceneCollaborator(r *http.Request, sceneID primitive.ObjectID) bool {
	if IsAdmin(r) {
		return true
	}

	authParams := r.Context().Value("auth_params")
	if authParams == nil {
		// No authentication context - not a collaborator
		return false
	}
	params := authParams.(map[string]interface{})
	token := params["token"].(*auth.Token)
	userEmail := helper.GetStringFromField(token.Claims, "email", "")

	sceneDoc := bson.M{}
	db, err := Mongo()
	if err != nil {
		Logger.Error(err)
		return false
	}
	filter := bson.M{"ID": sceneID}
	found, _ := db.FindOne(constants.SceneCollectionName, filter, &sceneDoc)

	if !found {
		return false
	}

	isOwner := CheckDocOwner(r, sceneDoc)
	if isOwner {
		return true
	}

	isCollaborator := false
	if arr, ok := sceneDoc["Collaborators"].(primitive.A); ok {
		for _, v := range arr {
			if email, ok := v.(string); ok && email == userEmail {
				isCollaborator = true
				break
			}
		}
	}

	return isCollaborator
}

// CheckIfModifiedSince checks if the document has been modified since the client's last request.
// Returns true if the client should receive a 304 Not Modified response.
func CheckIfModifiedSince(r *http.Request, doc bson.M, timeFieldName string) bool {
	ifModSince := r.Header.Get("If-Modified-Since")
	if ifModSince == "" {
		return false
	}

	clientTime, err := time.Parse(http.TimeFormat, ifModSince)
	if err != nil {
		return false
	}

	// Get the document's update time
	if updateTimeRaw, exists := doc[timeFieldName]; exists {
		if updateTime, ok := updateTimeRaw.(primitive.DateTime); ok {
			docModTime := updateTime.Time()
			// If document hasn't been modified since client's last request, return true for 304
			return !docModTime.After(clientTime)
		}
	}

	return false
}

// SetLastModifiedHeader sets the Last-Modified header based on the document's update time.
func SetLastModifiedHeader(w http.ResponseWriter, doc bson.M, timeFieldName string) {
	if updateTimeRaw, exists := doc[timeFieldName]; exists {
		if updateTime, ok := updateTimeRaw.(primitive.DateTime); ok {
			w.Header().Set("Last-Modified", updateTime.Time().UTC().Format(http.TimeFormat))
		}
	}
}

// HandleCacheHeaders checks If-Modified-Since header and sets Last-Modified header.
// Returns true if a 304 Not Modified response should be sent.
func HandleCacheHeaders(w http.ResponseWriter, r *http.Request, doc bson.M, timeFieldName string) bool {
	// Set Last-Modified header
	SetLastModifiedHeader(w, doc, timeFieldName)

	// Check If-Modified-Since header
	if CheckIfModifiedSince(r, doc, timeFieldName) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}

	return false
}
