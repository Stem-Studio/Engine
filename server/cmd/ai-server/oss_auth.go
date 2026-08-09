package main

import (
	"context"
	"net/http"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/helper"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/logger"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
	serverContext "github.com/dotErth/ai-3d-sandbox/stemstudio/server/context"
)

// ossDummyToken is the constant the editor sends in the Authorization
// header. The open-source deployment trusts the local machine — there's no Firebase,
// no multi-tenant identity, no billing. A single dummy token is enough to
// keep the existing per-handler auth shape (`auth_params["token"].UID`) working.
const ossDummyToken = "stemstudio-token"

// ossLocalIdentity is the minimal stand-in injected into the request
// context. It exposes only the `UID` field that downstream AI handlers
// read from a verified Firebase token; nothing else is needed in
// single-user OSS mode.
type ossLocalIdentity struct {
	UID string
}

// ossAuthMiddleware accepts the constant `stemstudio-token` and rejects
// anything else with 401. Mounted by the ai-server binary via
// `server.SetAuthMiddleware`.
//
// Routes registered with constants.None keep the original public-route
// semantics (health, capabilities, configure-keys). Everything else must
// carry the explicit local dummy token.
func ossAuthMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	if authority, ok := serverContext.GetAPIAuthority(r.Method, r.URL.Path); ok && authority == constants.None {
		next(w, r)
		return
	}

	idToken := helper.ExtractIDToken(r)
	if idToken != ossDummyToken {
		http.Error(w, "Unauthorized (OSS)", http.StatusUnauthorized)
		return
	}

	params := map[string]interface{}{
		"token":     &ossLocalIdentity{UID: "stemstudio-local-user"},
		"authority": constants.User,
		"isAdmin":   true,
	}
	ctx := context.WithValue(r.Context(), "auth_params", params)
	ctx = logger.AddUserIDToContext(ctx, "stemstudio-local-user")
	next(w, r.WithContext(ctx))
}
