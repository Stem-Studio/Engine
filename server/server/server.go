package server

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/logger"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/middleware"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/telemetry"
	"github.com/urfave/negroni"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"
)

// AuthMiddlewareFunc is the signature accepted by SetAuthMiddleware. It
// matches negroni's HandlerFunc — the third parameter is the chain
// continuation.
type AuthMiddlewareFunc func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc)

// authMiddlewareOverride is set at startup by binaries that want to replace
// the default Firebase-based token validation. Used by `cmd/ai-server` for
// the OSS single-user shortcut. Production binaries leave it nil and the
// default `middleware.ValidateTokenMiddleware` runs.
var authMiddlewareOverride AuthMiddlewareFunc

// SetAuthMiddleware lets a binary entry point install a custom auth
// middleware before calling cmd.Execute(). Call this once, before Start().
// Passing nil restores the default Firebase validation. Intended for
// `cmd/ai-server/main.go`; production binaries should not call it.
func SetAuthMiddleware(fn AuthMiddlewareFunc) {
	authMiddlewareOverride = fn
}

// resolvedAuthMiddleware returns the override if set, otherwise the
// default Firebase validator.
func resolvedAuthMiddleware() AuthMiddlewareFunc {
	if authMiddlewareOverride != nil {
		return authMiddlewareOverride
	}
	return middleware.ValidateTokenMiddleware
}

// Start start the web server.
//
// Negroni is an idiomatic HTTP Middleware for Golang. `negroni.Classic` add three
// middleware: Recovery, Logger, Static. We add two: CrossOriginHandler, GZipHandler.
//
// Then, we use `httptreemux` to map route to the handler.
func Start() {
	// Honor a runtime port override. Accept either ":8081" or "8081".
	if portOverride := os.Getenv("AI_SERVER_PORT"); portOverride != "" {
		if portOverride[0] != ':' {
			portOverride = ":" + portOverride
		}
		serverContext.Config.Server.Port = portOverride
	}

	logger.GetLogger().Info("Starting StemStudio server",
		zap.String("port", serverContext.Config.Server.Port),
		zap.String("service", "stemstudio-server"),
	)

	// Initialize OpenTelemetry tracing (no-op if OTEL_EXPORTER_OTLP_ENDPOINT is not set)
	otelShutdown, err := telemetry.InitTelemetry(context.Background())
	if err != nil {
		logger.GetLogger().Warn("Failed to initialize OpenTelemetry", zap.Error(err))
	}
	defer func() {
		if err := otelShutdown(context.Background()); err != nil {
			logger.GetLogger().Error("Failed to shutdown OpenTelemetry", zap.Error(err))
		}
	}()

	logger.GetLogger().Info("Open-source server: skipping LakeFS storage bucket initialization")

	// register custom mime-constants
	if err := mime.AddExtensionType(".css", "text/css"); err != nil {
		logger.GetLogger().Warn("Failed to add CSS extension type", zap.Error(err))
	}
	if err := mime.AddExtensionType(".js", "application/javascript; charset=UTF-8"); err != nil {
		logger.GetLogger().Warn("Failed to add JS extension type", zap.Error(err))
	}

	logger.GetLogger().Info("Deploying HTTP static directory",
		zap.String("path", serverContext.Config.Path.PublicDir),
	)
	recovery := negroni.NewRecovery()
	// Replace negroni's basic logger with our structured HTTP logging middleware
	static := negroni.NewStatic(http.Dir(serverContext.Config.Path.PublicDir))

	handler := negroni.New(recovery)
	// Add our structured HTTP logging middleware
	handler.Use(negroni.HandlerFunc(func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
		logger.HTTPLoggingMiddleware(http.HandlerFunc(next)).ServeHTTP(w, r)
	}))
	handler.Use(negroni.HandlerFunc(middleware.CrossOriginMiddleware))
	handler.Use(negroni.HandlerFunc(middleware.CacheMiddleware))
	handler.Use(negroni.HandlerFunc(middleware.StaticETagMiddleware(serverContext.Config.Path.PublicDir)))
	handler.Use(static)
	handler.Use(negroni.HandlerFunc(middleware.AssetProxyMiddleware))
	handler.Use(negroni.HandlerFunc(resolvedAuthMiddleware()))
	handler.Use(negroni.HandlerFunc(middleware.RequestCacheMiddleware))
	handler.Use(negroni.HandlerFunc(middleware.CompressionMiddleware))
	handler.UseHandler(otelhttp.NewHandler(serverContext.Mux, "de-sandbox"))

	srv := http.Server{
		Addr:    serverContext.Config.Server.Port,
		Handler: handler,
	}

	// Configure server-level keep-alive settings if enabled
	if serverContext.Config.Server.KeepAliveEnabled {
		srv.IdleTimeout = time.Duration(serverContext.Config.Server.KeepAliveTimeout) * time.Second
		srv.ReadTimeout = time.Duration(serverContext.Config.Server.KeepAliveTimeout+30) * time.Second  // slightly longer than idle
		srv.WriteTimeout = time.Duration(serverContext.Config.Server.KeepAliveTimeout+30) * time.Second // slightly longer than idle
		srv.SetKeepAlivesEnabled(true)
		logger.GetLogger().Info("Keep-alive enabled",
			zap.Int("timeout_seconds", serverContext.Config.Server.KeepAliveTimeout),
			zap.Int("read_timeout_seconds", serverContext.Config.Server.KeepAliveTimeout+30),
			zap.Int("write_timeout_seconds", serverContext.Config.Server.KeepAliveTimeout+30),
		)
	} else {
		srv.SetKeepAlivesEnabled(false)
		logger.GetLogger().Info("Keep-alive disabled")
	}
	idleConnsClosed := make(chan struct{})

	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt)
		<-sigint

		// We received an interrupt signal, shut down.
		logger.GetLogger().Info("🛑 [Server] Received shutdown signal, shutting down gracefully...")

		// Stop the scheduler first to let jobs finish
		if serverContext.Scheduler != nil {
			serverContext.Scheduler.Stop()
		}

		if err := srv.Shutdown(context.Background()); err != nil {
			// Error from closing listeners, or context timeout.
			logger.GetLogger().Error("HTTP server shutdown error", zap.Error(err))
		}
		close(idleConnsClosed)
	}()

	// Log server ready message
	logger.GetLogger().Info("🚀 [Server] StemStudio server is ready and listening for requests",
		zap.String("address", "http://localhost"+serverContext.Config.Server.Port),
		zap.String("status", "ready"),
	)

	// Also print to console for immediate visibility
	fmt.Printf("\n🚀 StemStudio Server Ready!\n")
	fmt.Printf("📍 Address: http://localhost%s\n", serverContext.Config.Server.Port)
	fmt.Printf("📊 Status: Listening for requests\n")
	fmt.Printf("🔗 Health: http://localhost%s/api/Map/List (test endpoint)\n", serverContext.Config.Server.Port)
	fmt.Printf("📝 Logs: %s\n\n", serverContext.Config.Log.File)

	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		// Error starting or closing listener:
		logger.GetLogger().Error("HTTP server ListenAndServe error", zap.Error(err))
	}

	<-idleConnsClosed
}
