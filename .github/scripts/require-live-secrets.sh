#!/usr/bin/env bash
# Report whether every named environment variable is non-blank.
# Writes present=true or present=false to $GITHUB_OUTPUT.
# Prints a notice and a step summary when one is missing.
# Never prints a secret value. Names must be uppercase env identifiers.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: require-live-secrets.sh NAME [NAME...]" >&2
  exit 1
fi

missing=""
for name in "$@"; do
  if [[ ! "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "refusing secret name: ${name}" >&2
    exit 1
  fi
  value="$(printenv "$name" || true)"
  trimmed="$(printf '%s' "$value" | tr -d '[:space:]')"
  if [[ -z "$trimmed" ]]; then
    missing="${missing}${missing:+, }${name}"
  fi
done

output="${GITHUB_OUTPUT:-/dev/stdout}"
if [[ -n "$missing" ]]; then
  echo "present=false" >> "$output"
  echo "::notice title=Live tests skipped::Missing ${missing}. This job did not call the provider."
  echo "Live tests skipped: missing ${missing}."
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "### Skipped"
      echo "Missing secret(s): \`${missing}\`."
      echo "Add them under Settings → Secrets and variables → Actions. See the Live tests section of CONTRIBUTING.md."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
else
  echo "present=true" >> "$output"
fi
