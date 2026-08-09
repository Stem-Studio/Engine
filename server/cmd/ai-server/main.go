// Binary ai-server runs only the AI-related controllers from the StemStudio
// server. It is built from the same Go module and shares server context,
// middleware, and helpers with the rest of the server package.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"

	// Register sub packages.
	// Health probe — minimal, shared with the combined binary.
	_ "github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/health" // health api

	// AI surface.
	_ "github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai"                   // AI api
	_ "github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/byok"              // AI capabilities / BYOK
	_ "github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/image_generation"  // image_generation api
	_ "github.com/dotErth/ai-3d-sandbox/stemstudio/server/controllers/tools/ai/object_generation" // object_generation api
)

func main() {
	// Replace the default Firebase-based token validator with the local
	// single-user shortcut.
	server.SetAuthMiddleware(ossAuthMiddleware)

	if err := runAIServer(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runAIServer(args []string) error {
	if len(args) > 0 && args[0] == "serve" {
		args = args[1:]
	}

	flags := flag.NewFlagSet("stemstudio-ai-server", flag.ContinueOnError)
	configPath := flags.String("config", "./config.toml", "config file")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if _, err := os.Stat(*configPath); os.IsNotExist(err) {
		return fmt.Errorf("cannot find config file: %v", *configPath)
	}

	if err := serverContext.Create(*configPath); err != nil {
		return err
	}

	server.Start()
	return nil
}
