#!/usr/bin/env bash
# context7 — fetch up-to-date library docs from context7.com into LLM context.
# See SKILL.md. Two-step: `search` to resolve a library id + version tag, then `get`.
set -euo pipefail

API="https://context7.com/api/v1"

usage() {
	cat <<'EOF'
Usage:
  docs.sh search <query>                           # find libraries; show ids + versions
  docs.sh get <library-id> <version> [options]     # fetch docs for a version

get options:
  --topic "<text>"   topic to focus on (e.g. "routing", "validation rules")
  --tokens <n>       max tokens returned (default 5000). Always scope with --topic.

Notes:
  <version> is bare (e.g. 13.x); it is auto-mapped to the __branch__ tag the API needs.
  If unsure of <library-id> or <version>, run `search` first.

Examples:
  docs.sh search laravel
  docs.sh get /laravel/docs 13.x --topic routing --tokens 4000
EOF
}

die() { echo "error: $*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (install it first)"; }
require curl
require jq

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 0; }
shift

case "$cmd" in
	search)
		q="${1:-}"
		[ -z "$q" ] && die "missing search query"
		out="$(curl -sLG "$API/search" --data-urlencode "query=$q" \
			| jq -r '.results[] | "id:       \(.id)\ntitle:    \(.title)\nbranch:   \(.branch)\nversions: \(.versions | join(", "))\ntrust:    \(.trustScore)   total tokens: \(.totalTokens)\n---"' 2>/dev/null || true)"
		[ -z "$out" ] && die "no results for \"$q\" (or request failed)"
		printf '%s\n' "$out"
		;;

	get)
		id="${1:-}"; ver="${2:-}"
		[ -z "$id" ] || [ -z "$ver" ] && { echo "error: need <library-id> <version>" >&2; usage; exit 1; }
		shift 2 || true
		topic=""; tokens="5000"
		while [ $# -gt 0 ]; do
			case "$1" in
				--topic)  topic="${2:-}"; shift 2 || die "--topic needs a value" ;;
				--tokens) tokens="${2:-}"; shift 2 || die "--tokens needs a value" ;;
				-h|--help) usage; exit 0 ;;
				*) die "unknown option: $1" ;;
			esac
		done

		# Build candidate tags. Bare "13.x" -> "__branch__13.x". Fall back to bare, then latest.
		if [[ "$ver" == __* ]]; then
			tags=("$ver")
		else
			tags=( "__branch__$ver" "$ver" "latest" )
		fi

		args=( -sLG --data-urlencode "type=txt" )
		[ -n "$topic" ]  && args+=( --data-urlencode "topic=$topic" )
		args+=( --data-urlencode "tokens=$tokens" )

		for tag in "${tags[@]}"; do
			body="$(curl "${args[@]}" "$API$id/$tag" 2>/dev/null || true)"
			if [ -n "$body" ] && ! grep -q "not found for library" <<<"$body"; then
				printf '%s\n' "$body"
				exit 0
			fi
		done

		die "could not fetch '$id' @ '$ver' (tried: ${tags[*]}). Re-run 'search' to confirm the id and available version tags."
		;;

	-h|--help|help) usage ;;
	*) echo "error: unknown command '$cmd'" >&2; usage; exit 1 ;;
esac
