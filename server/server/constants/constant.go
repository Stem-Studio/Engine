package constants

const (
	// Collections for asset management
	AssetCollectionName           string = "_Asset"
	AssetDependencyCollectionName string = "_AssetDependency"
	AssetDerivativeCollectionName string = "_AssetDerivative"
	AssetImportCollectionName     string = "_AssetImport"
	AssetImportJobCollectionName  string = "_AssetImportJob"
	AssetReleaseCollectionName    string = "_AssetRelease"
	AssetUploadCollectionName     string = "_AssetUpload"
	// CategoryCollectionName is the collection name that we store categories in mongo.
	CategoryCollectionName string = "_Category"
	// SceneCollectionName is the collection name that we store scenes in mongo.
	SceneCollectionName string = "_Scene"
	// StarterCollectionName is the collection name that we store stats for scene starters in mongo.
	StarterCollectionName string = "_StarterStats"
	// WhitelistCollectionName is the collection name that we store scenes in mongo.
	// SceneCollectionName is the collection name that we store scenes in mongo.
	InventoryCollectionName string = "_Inventory"
	// WhitelistCollectionName is the collection name that we store scenes in mongo.
	WhitelistCollectionName string = "_Whitelist"
	// MeshCollectionName is the collection name that we store meshes in mongo.
	MeshCollectionName string = "_Mesh"
	// AvatarPartsCollectionName is the collection that stores avatar part assets used by the AvatarCreator.
	AvatarPartsCollectionName string = "_Avatar_Parts"
	// AvatarCreatorCollectionName is the collection that stores composed avatar registrations (parts-based system).
	AvatarCreatorCollectionName string = "_Avatar_Creator"
	// UserAvatarsCollectionName is the collection of per-user avatar entries (premade pointers or composed configurations).
	UserAvatarsCollectionName string = "_User_Avatars"
	// CollectionSkeletonOverridesCollectionName stores per-collection (keyed by Body asset ID) skeleton override blobs
	// that admins author once via the Avatar Creator's "Detect Skeleton" flow. Non-admin clients fetch the saved
	// override at rig-creation time so end users never run the multi-view CV pose fit themselves.
	CollectionSkeletonOverridesCollectionName string = "_Avatar_Collection_Skeletons"
	// LibraryCollectionName is the collection name that we store libraries in mongo.
	LibraryCollectionName string = "_Library"
	// BehaviorCollectionName is the collection name that we store behaviors in mongo.
	BehaviorCollectionName string = "_Behavior"
	// NPCCollectionName is the collection name that we store NPCs in mongo.
	NPCCollectionName string = "_NPC"
	// DiscordKeysCollectionName is the collection name that we store discord keys in mongo.
	DiscordKeysCollectionName string = "_DiscordKeys"
	// SteamKeysCollectionName is the collection name that we store steam keys in mongo.
	SteamKeysCollectionName string = "_SteamKeys"
	// CrazyGamesKeysCollectionName is the collection name that we store CrazyGames keys in mongo.
	CrazyGamesKeysCollectionName string = "_CrazyGamesKeys"
	// MapCollectionName is the collection name that we store textures in mongo.
	MapCollectionName string = "_Map"
	// TextureCollectionName is the collection name that we store textures in mongo.
	TextureCollectionName string = "_Texture"
	// MaterialCollectionName is the collection name that we store materials in mongo.
	MaterialCollectionName string = "_Material"
	// AudioCollectionName is the collection name that we store audios in mongo.
	AudioCollectionName string = "_Audio"
	// ApiMappingCollectionName is the collection name that we store API proxy mappings in mongo.
	ApiMappingCollectionName string = "_ApiMapping"
	// GameMappingCollectionName is the collection name that we store game slug mappings in mongo.
	GameMappingCollectionName string = "_GameMapping"
	// AnimationCollectionName is the collection name that we store animations in mongo.
	AnimationCollectionName string = "_Animation"
	// ParticleCollectionName is the collection name that we store particles in mongo.
	ParticleCollectionName string = "_Particle"
	// PrefabCollectionName is the collection name that we store prefabs in mongo.
	PrefabCollectionName string = "_Prefab"
	// PrefabRevisionCollectionName is the collection name that we store prefab revisions in mongo.
	PrefabRevisionCollectionName string = "_PrefabRevision"
	// CharacterCollectionName is the collection name that we store characters in mongo.
	CharacterCollectionName string = "_Character"
	// ScreenshotCollectionName is the collection name that we store screenshots in mongo.
	ScreenshotCollectionName string = "_Screenshot"
	// VideoCollectionName is the collection name that we store videos in mongo.
	VideoCollectionName string = "_Video"
	// FileCollectionName is the collection name that we store files in mongo.
	FileCollectionName string = "_File"
	// ConfigCollectionName is the collection name that we store system configs in mongo.
	ConfigCollectionName string = "_Config"
	// HomepageStatsCollectionName stores maintained aggregate counters for the public homepage.
	HomepageStatsCollectionName string = "_HomepageStats"
	// HomepageSuggestionsCollectionName stores prompt ideas shown on the public homepage.
	HomepageSuggestionsCollectionName string = "_HomepageSuggestions"
	// RoleCollectionName is the collection name that we store roles in mongo.
	RoleCollectionName string = "_Role"
	// UserCollectionName is the collection name that we store users in mongo.
	UserCollectionName string = "_User"
	// ImagesCollectionName is the collection name that we store asssets in mongo.
	ImagesCollectionName string = "_Assets"
	// CopilotHistoryCollectionName is the collection name that we store copilot history in mongo.
	CopilotHistoryCollectionName string = "_CopilotHistory"
	// CopilotTaskCollectionName is the collection name that stores per-project Copilot task state.
	CopilotTaskCollectionName string = "_CopilotTask"
	// SceneRevisionCaptureCollectionName stores mutable user-facing metadata for immutable scene revisions.
	SceneRevisionCaptureCollectionName string = "_SceneRevisionCapture"
	// OperatingAuthorityCollectionName is the collection name that we store roles' authorities in mongo.
	OperatingAuthorityCollectionName string = "_OperatingAuthority"
	// DepartmentCollectionName is the collection name that we store departments in mongo.
	DepartmentCollectionName string = "_Department"
	// PluginCollectionName is the collection name that we store plugins in mongo.
	PluginCollectionName string = "_Plugin"
	// TypefaceCollectionName is the collection name that we store typefaces in mongo.
	TypefaceCollectionName string = "_Typeface"
	// RegistrationCollectionName is the collection name that we store registration applications in mongo.
	RegistrationCollectionName string = "_Registration"
	// ModelGenerationJobCollectionName is the collection name for background model generation jobs.
	ModelGenerationJobCollectionName string = "_ModelGenerationJob"
	// StripeProductsCollectionName is retained for legacy document compatibility.
	// Deprecated: the open-source server does not implement billing handlers.
	StripeProductsCollectionName string = "_StripeProducts"
	// StripePurchasesCollectionName is retained for legacy document compatibility.
	// Deprecated: the open-source server does not implement billing handlers.
	StripePurchasesCollectionName string = "_StripePurchases"
	// RewardRulesCollectionName stores configurable event-to-reward mappings.
	RewardRulesCollectionName string = "_RewardRule"
	// RewardEventsCollectionName stores ingested reward events.
	RewardEventsCollectionName string = "_RewardEvent"
	// RewardGrantsCollectionName stores applied reward ledger entries.
	RewardGrantsCollectionName string = "_RewardGrant"
	// RewardBalancesCollectionName stores aggregated balances by reward type per user.
	RewardBalancesCollectionName string = "_RewardBalance"
	// HistorySuffix is the suffix we add to a scene collection to store history data.
	HistorySuffix string = "_history"
	// VersionField is the field we add to scene history records, and it is the scene version number.
	VersionField string = "_version"
)

type Authority string

// Authority means the authority to query web api.

const (
	// None means the api required no authority.
	None Authority = "NONE"
	User Authority = "USER"
)

const (
	WhisperAPIEndpoint    string = "https://api.openai.com/v1/audio/transcriptions"
	ChatGPTAPIEndpoint    string = "https://api.openai.com/v1/chat/completions"
	ElevenLabsAPIEndpoint string = "https://api.elevenlabs.io/v1/text-to-speech/"
	ScenarioAPIBaseURL    string = "https://api.cloud.scenario.com/v1"
	Tripo3dAPIBaseURL     string = "https://api.tripo3d.ai/v2/openapi/"
)

// Account types
type AccountType string

const (
	AccountTypeRegular    AccountType = "regular"
	AccountTypeInfluencer AccountType = "influencer"
	AccountTypeAdmin      AccountType = "admin"
)

// Default AI Credits for regular users
const (
	AiCreditsDefault int = 200
)

// Influencer AI Credits (5x regular)
const (
	InfluencerAiCreditsDefault int = 1000
)

// GetAiCreditsForAccountType returns the appropriate AI credits for a given account type
func GetAiCreditsForAccountType(accountType AccountType) int {
	switch accountType {
	case AccountTypeInfluencer:
		return InfluencerAiCreditsDefault
	default:
		return AiCreditsDefault
	}
}
