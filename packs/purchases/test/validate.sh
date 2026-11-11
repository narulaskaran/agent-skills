#!/usr/bin/env bash
# Runs Stripe's payment validator (@stripe/link-validate) against Nano. Run inside the Nano
# container as the nano user; see ../VALIDATION.md.
#
#   validate.sh <link-cli checkout> [validator options, e.g. --channel browser,webmcp]
#
# Each task the validator prints goes to its own Nano process on the stdin channel with a fresh
# data directory, so every task is a new conversation. All of them share one Link login.
set -euo pipefail

repo="${1:?usage: validate.sh <link-cli checkout> [validator options]}"
shift
data="${NANO_DATA_DIR:-/data}"
export LINK_AUTH_FILE="${LINK_AUTH_FILE:-$data/link/auth.json}"
: "${STRIPE_SECRET_KEY:?set STRIPE_SECRET_KEY to a Stripe sandbox key (sk_test_...)}"

run="$data/validate/$(date +%Y%m%d-%H%M%S)"
events="$run/events.jsonl"
mkdir -p "$run"
(cd "$repo" && exec node packages/validate/src/index.ts --json "$@") >"$events" 2>"$run/validator.log" &
validator=$!

until grep -q '"event":"ready"' "$events"; do
	if ! kill -0 "$validator" 2>/dev/null; then
		cat "$run/validator.log" >&2
		wait "$validator" || exit $?
		exit 1
	fi
	sleep 1
done

finished() { jq -e --arg id "$1" 'select(.event == "validation" and .validation == $id)' "$events" >/dev/null; }

while read -r task; do
	id="$(jq -r .validation <<<"$task")"
	dir="$run/$id"
	mkdir -p "$dir/profile"
	# A profile skips first-run onboarding, which would otherwise answer the task with introductions.
	printf '# Owner\nTest owner for an automated payment validation run.\n' >"$dir/profile/USER.md"
	printf '{"timezone":"UTC"}\n' >"$dir/settings.json"
	echo "validate: $id -> $dir"
	(
		# Nano stops when stdin closes, so hold it open until the validator has judged this task.
		{
			jq -r .task <<<"$task"
			while kill -0 "$validator" 2>/dev/null && ! finished "$id"; do sleep 5; done
		} | NANO_DATA_DIR="$dir" NANO_CHANNEL=stdin node /app/src/index.ts >"$dir/transcript.txt" 2>"$dir/nano.log"
	) &
done < <(jq -c 'select(.event == "ready") | .tasks[]' "$events")

code=0
wait "$validator" || code=$?
wait
for dir in "$run"/*/; do NANO_DATA_DIR="${dir%/}" browser close >/dev/null 2>&1 || true; done
jq -r 'select(.event == "result") | .validations[] | "\(.id): \(.status)\(if .error then " - " + .error else "" end)"' "$events"
echo "validate: exit $code, logs in $run"
exit "$code"
