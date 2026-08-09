package helper

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/BurntSushi/toml"
)

// GetConfig read toml format file `config.toml`, and parse ConfigModel.
//
// See: https://github.com/toml-lang/toml
func GetConfig(path string) (config *ConfigModel, err error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	defer file.Close()

	if _, err = toml.DecodeReader(file, &config); err != nil {
		return nil, err
	}

	// parse mongoDB connection string.
	if config.Database.User != "" && config.Database.Password != "" {
		// If auth is empty, this will cause `error parsing uri: authsource without username is invalid` error.
		config.Database.Connection = fmt.Sprintf(
			"mongodb://%v:%v@%v:%v",
			config.Database.User,
			config.Database.Password,
			config.Database.Host,
			config.Database.Port,
		)
	} else {
		config.Database.Connection = fmt.Sprintf(
			"mongodb://%v:%v",
			config.Database.Host,
			config.Database.Port,
		)
	}

	// parse proxy API map file
	if config.Proxy.ApiMapConfigPath != "" {
		fmt.Println("Loading api map config from: " + config.Proxy.ApiMapConfigPath)
		jsonFile, err := os.Open(config.Proxy.ApiMapConfigPath)
		if err != nil {
			fmt.Printf("Failed to open API proxy map config: %s\n%v\n", config.Proxy.ApiMapConfigPath, err)
			return nil, err
		}
		defer jsonFile.Close()

		fileInfo, _ := jsonFile.Stat()
		fileSize := fileInfo.Size()

		buffer := make([]byte, fileSize)
		_, err = jsonFile.Read(buffer)
		if err != nil {
			fmt.Printf("Failed to read API proxy map config: %s\n%v\n", config.Proxy.ApiMapConfigPath, err)
			return nil, err
		}

		err = json.Unmarshal(buffer, &config.Proxy.PathToUrlMap)
		if err != nil {
			fmt.Printf("Failed to parse API proxy map config: %s\n%v\n", config.Proxy.ApiMapConfigPath, err)
			return nil, err
		}

		fmt.Println("API proxy map config:")
		for key, value := range config.Proxy.PathToUrlMap {
			fmt.Printf("%s: %v\n", key, value)
		}
	}

	// In windows system, path separator "/" should be replace with "\\".
	if strings.HasPrefix(runtime.GOOS, "windows") {
		config.Path.PublicDir = strings.ReplaceAll(config.Path.PublicDir, "/", "\\")
		config.Path.LogDir = strings.ReplaceAll(config.Path.LogDir, "/", "\\")
	}

	return
}

// AiCreditsConfigModel defines the credit cost per AI feature.
type AiCreditsConfigModel struct {
	ImageGenCost       int `toml:"image_gen_cost"`
	ObjectGenCost      int `toml:"object_gen_cost"`
	CopilotCost        int `toml:"copilot_cost"`
	DefaultAmount      int `toml:"default_amount"`
	CreditsRefreshRate int `toml:"credits_refresh_rate"` // in seconds
}

// StripeConfigModel is retained for backward config compatibility. The
// open-source server does not implement billing and ignores every value.
type StripeConfigModel struct {
	SecretKey             string `toml:"secret_key"`
	WebhookSecret         string `toml:"webhook_secret"`
	StarterPriceOneTime   string `toml:"starter_price_one_time"`
	StarterPriceRecurring string `toml:"starter_price_recurring"`
	ProPriceOneTime       string `toml:"pro_price_one_time"`
	ProPriceRecurring     string `toml:"pro_price_recurring"`
}

// ConfigModel is the structure of file `config.toml`.
type ConfigModel struct {
	Server    ServerConfigModel      `toml:"server"`
	Database  DatabaseConfigModel    `toml:"database"`
	Authority AuthorityConfigModel   `toml:"authority"`
	LakeFS    LakeFSConfigModel      `toml:"lakefs"`
	Proxy     ApiProxyMapConfigModel `toml:"proxy"`
	Upload    UploadConfigModel      `toml:"upload"`
	Path      PathConfigModel        `toml:"path"`
	Log       LogConfigModel         `toml:"log"`
	History   HistoryConfigModel     `toml:"history"`
	AiCredits AiCreditsConfigModel   `toml:"ai_credits"`
	Stripe    StripeConfigModel      `toml:"stripe"` // Deprecated: ignored by the open-source server.
	Redis     RedisConfigModel       `toml:"redis"`
}

// RedisConfigModel is the Redis config section in `config.toml`.
type RedisConfigModel struct {
	Address      string `toml:"address"`
	DB           int    `toml:"db"`
	SceneListTTL int    `toml:"scene_list_ttl"` // seconds
}

type HistoryConfigModel struct {
	MaxVersions int `toml:"max_versions"`
}

// ServerConfigModel is the server config section in `config.toml`.
type ServerConfigModel struct {
	Port              string `toml:"port"`
	KeepAliveEnabled  bool   `toml:"keep_alive_enabled"`
	KeepAliveTimeout  int    `toml:"keep_alive_timeout"`  // seconds
	KeepAliveInterval int    `toml:"keep_alive_interval"` // seconds for heartbeat
}

// DatabaseConfigModel is the database config section in `config.toml`.
type DatabaseConfigModel struct {
	Type     string `toml:"type"`
	Host     string `toml:"host"`
	Port     int    `toml:"port"`
	User     string `toml:"user"`
	Password string `toml:"password"`
	Database string `toml:"database"`

	// Connection should not read from config.toml.
	Connection string
}

// AuthorityConfigModel is the authority config section in `config.toml`.
type AuthorityConfigModel struct {
	FirebaseConfigPath string `toml:"firebase_config_path"`
}

type LakeFSConfigModel struct {
	Host                   string `toml:"host"`
	AccessKeyId            string `toml:"access_key_id"`
	SecretAccessKey        string `toml:"secret_access_key"`
	StorageAccessKeyId     string `toml:"storage_access_key_id"`
	StorageSecretAccessKey string `toml:"storage_secret_access_key"`
	StorageScheme          string `toml:"storage_scheme"`
	StorageBucket          string `toml:"storage_bucket"`
	StorageEndpoint        string `toml:"storage_endpoint"`
	StorageRegion          string `toml:"storage_region"`
}

type ApiProxyMapConfigModel struct {
	ApiMapConfigPath string `toml:"api_map_config_path"`

	PathToUrlMap map[string]string
}

// UploadConfigModel is the upload config section in `config.toml`.
type UploadConfigModel struct {
	MaxSize int64 `toml:"max_size"`
}

// PathConfigModel is the authority path section in `config.toml`.
type PathConfigModel struct {
	BuildDir  string `toml:"build_dir"`
	PublicDir string `toml:"public_dir"`
	LogDir    string `toml:"log_dir"`
}

// LogConfigModel is the log config section in `config.toml`.
type LogConfigModel struct {
	File        string `toml:"file"`        // log file path
	Level       string `toml:"level"`       // debug, info, warn, error
	Format      string `toml:"format"`      // json, console
	MaxSize     int    `toml:"max_size"`    // megabytes
	MaxBackups  int    `toml:"max_backups"` // number of backup files
	MaxAge      int    `toml:"max_age"`     // days
	Compress    bool   `toml:"compress"`    // compress old files
	Development bool   `toml:"development"` // development mode
}
