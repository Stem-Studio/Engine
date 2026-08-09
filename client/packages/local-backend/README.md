# Local Backend Package

Local Node.js backend used by standalone editor/player flows, including WebContainer.

## Run

- `bun run local-backend:start`

## Configuration

- `LOCAL_BACKEND_HOST` (default: `127.0.0.1`)
- `LOCAL_BACKEND_PORT` (default: `3030`)
- `LOCAL_BACKEND_DATA_FILE` (default: `.local-backend/scenes.json`)

The web app can target this adapter by using `?backend=local` or setting `REACT_ENGINE_BACKEND_MODE=local`.
