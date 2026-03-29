#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-}"
ENV_FILE="${LINEAR_ENV_FILE:-$ROOT_DIR/.env}"
API_TARGET="${NEXT_PUBLIC_API_URL:-http://localhost:${API_PORT:-3001}}"
NGROK_API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
NGROK_LOG_FILE="$(mktemp -t superset-linear-ngrok.XXXXXX.log)"
NGROK_PUBLIC_URL="${LINEAR_PUBLIC_API_URL:-}"
NGROK_PID=""

trim_trailing_slash() {
	local value="$1"
	while [[ "$value" == */ ]]; do
		value="${value%/}"
	done
	printf '%s' "$value"
}

cleanup() {
	if [ -n "$NGROK_PID" ] && kill -0 "$NGROK_PID" >/dev/null 2>&1; then
		kill "$NGROK_PID" >/dev/null 2>&1 || true
	fi
	rm -f "$NGROK_LOG_FILE"
}

trap cleanup EXIT INT TERM

persist_linear_public_api_url() {
	if [ ! -f "$ENV_FILE" ]; then
		echo "Skipping .env update because $ENV_FILE does not exist."
		return
	fi

	local temp_env_file
	temp_env_file="$(mktemp -t superset-linear-env.XXXXXX)"

	awk -v value="$LINEAR_PUBLIC_API_URL" '
BEGIN { updated=0 }
/^LINEAR_PUBLIC_API_URL=/ {
	print "LINEAR_PUBLIC_API_URL=\"" value "\""
	updated=1
	next
}
{ print }
END {
	if (!updated) {
		print "LINEAR_PUBLIC_API_URL=\"" value "\""
	}
}
' "$ENV_FILE" >"$temp_env_file"

	mv "$temp_env_file" "$ENV_FILE"
	echo "Updated $ENV_FILE with LINEAR_PUBLIC_API_URL."
}

if ! command -v ngrok >/dev/null 2>&1; then
	echo "ngrok is required for Linear local testing."
	echo "Install it with 'brew install ngrok/ngrok/ngrok' and authenticate once."
	exit 1
fi

start_ngrok() {
	local -a ngrok_args=(http "$API_TARGET")

	if [ -n "$NGROK_PUBLIC_URL" ]; then
		NGROK_PUBLIC_URL="$(trim_trailing_slash "$NGROK_PUBLIC_URL")"
		ngrok_args+=(--url "$NGROK_PUBLIC_URL")
	fi

	ngrok "${ngrok_args[@]}" >"$NGROK_LOG_FILE" 2>&1 &
	NGROK_PID="$!"
}

resolve_ngrok_url() {
	local desired_url=""
	local attempt=0

	if [ -n "$NGROK_PUBLIC_URL" ]; then
		desired_url="$(trim_trailing_slash "$NGROK_PUBLIC_URL")"
	fi

	while [ "$attempt" -lt 30 ]; do
		if ! kill -0 "$NGROK_PID" >/dev/null 2>&1; then
			echo "ngrok exited before it exposed a public URL."
			cat "$NGROK_LOG_FILE"
			exit 1
		fi

		NGROK_PUBLIC_URL="$(
			curl -sf "$NGROK_API_URL" 2>/dev/null | bun -e '
const input = await Bun.stdin.text();
const desired = process.argv[1];
if (!input) {
	process.exit(0);
}
const data = JSON.parse(input);
const tunnel = data.tunnels?.find((candidate) =>
	candidate.public_url?.startsWith("https://") &&
		(!desired || candidate.public_url === desired),
);
if (tunnel?.public_url) {
	process.stdout.write(tunnel.public_url);
}
' "$desired_url" 2>/dev/null || true
		)"

		if [ -n "$NGROK_PUBLIC_URL" ]; then
			NGROK_PUBLIC_URL="$(trim_trailing_slash "$NGROK_PUBLIC_URL")"
			return
		fi

		attempt=$((attempt + 1))
		sleep 1
	done

	echo "Timed out waiting for ngrok to expose a public URL."
	cat "$NGROK_LOG_FILE"
	exit 1
}

if [ -n "$NGROK_PUBLIC_URL" ]; then
	NGROK_PUBLIC_URL="$(trim_trailing_slash "$NGROK_PUBLIC_URL")"
fi

start_ngrok
resolve_ngrok_url

export LINEAR_PUBLIC_API_URL="$NGROK_PUBLIC_URL"
persist_linear_public_api_url

CALLBACK_URL="$(trim_trailing_slash "$API_TARGET")/api/integrations/linear/callback"
WEBHOOK_URL="$LINEAR_PUBLIC_API_URL/api/integrations/linear/webhook"

echo "Linear local dev is ready."
echo "Callback URL: $CALLBACK_URL"
echo "Webhook URL:  $WEBHOOK_URL"
echo "Public API:   $LINEAR_PUBLIC_API_URL"
echo "ngrok API:    $NGROK_API_URL"

if [ "$MODE" = "--tunnel-only" ]; then
	echo "Tunnel-only mode is running. Keep this process open while testing."
	wait "$NGROK_PID"
	exit $?
fi

bun run dev
