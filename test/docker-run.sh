#!/usr/bin/env bash
# docker-run.sh — Build and run the ADW BDD test suite inside a Docker container.
#
# Usage:
#   bash test/docker-run.sh [--tags "@regression"] [--build] [--shell]
#
# Options:
#   --tags <tag>   Cucumber tag filter (default: @regression)
#   --build        Force image rebuild even if already cached
#   --shell        Open an interactive shell inside the container for debugging
#
# Environment variables forwarded into the container:
#   TEST_RUNTIME            set to "docker" automatically
#   BDD_TAGS                the tag filter (derived from --tags or default)
#   MOCK_STREAM_DELAY_MS    optional delay for the Claude CLI stub

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="adw-bdd-runner:latest"
DOCKERFILE="${REPO_ROOT}/test/Dockerfile"
BUILD_CONTEXT="${REPO_ROOT}/test"

BDD_TAGS="${BDD_TAGS:-@regression}"
FORCE_BUILD=false
OPEN_SHELL=false

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags)
      BDD_TAGS="$2"
      shift 2
      ;;
    --build)
      FORCE_BUILD=true
      shift
      ;;
    --shell)
      OPEN_SHELL=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: bash test/docker-run.sh [--tags \"@regression\"] [--build] [--shell]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Pre-flight: Docker must be available
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
  echo "Error: 'docker' is not on PATH. Install Docker and try again." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build the image
# ---------------------------------------------------------------------------
if $FORCE_BUILD || ! docker image inspect "$IMAGE_TAG" &>/dev/null; then
  echo "Building Docker image ${IMAGE_TAG}..."
  docker build -t "$IMAGE_TAG" -f "$DOCKERFILE" "$BUILD_CONTEXT"
else
  echo "Using cached image ${IMAGE_TAG} (pass --build to force rebuild)."
fi

# ---------------------------------------------------------------------------
# Run the container
# ---------------------------------------------------------------------------
# Volume mounts:
#   /workspace           — repo root, read-only
#   /workspace/node_modules — writable overlay so bun install can write here
#
# The node_modules overlay uses an anonymous volume, so each run starts with
# a clean install without polluting the host checkout.

EXTRA_ENV=()
if [[ -n "${MOCK_STREAM_DELAY_MS:-}" ]]; then
  EXTRA_ENV+=(-e "MOCK_STREAM_DELAY_MS=${MOCK_STREAM_DELAY_MS}")
fi

if $OPEN_SHELL; then
  echo "Opening interactive shell inside container (workspace: /workspace)..."
  docker run --rm -it \
    -v "${REPO_ROOT}:/workspace:ro" \
    -v /workspace/node_modules \
    -e "TEST_RUNTIME=docker" \
    -e "BDD_TAGS=${BDD_TAGS}" \
    "${EXTRA_ENV[@]}" \
    --entrypoint /bin/bash \
    "$IMAGE_TAG"
else
  echo "Running BDD scenarios tagged '${BDD_TAGS}' inside Docker container..."
  docker run --rm \
    -v "${REPO_ROOT}:/workspace:ro" \
    -v /workspace/node_modules \
    -e "TEST_RUNTIME=docker" \
    -e "BDD_TAGS=${BDD_TAGS}" \
    "${EXTRA_ENV[@]}" \
    "$IMAGE_TAG"
fi
