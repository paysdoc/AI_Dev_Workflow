# Generic Docker image for behavioral (Cucumber BDD) test execution.
#
# Contains only the runtime environment: Bun + Git.
# No ADW source code is baked in — all project files are provided
# at run time via volume mounts.
#
# Build:
#   docker build -t adw-bdd-runner:latest -f test/Dockerfile test/
#
# Run (via wrapper script):
#   bash test/docker-run.sh --tags "@regression"

FROM oven/bun:latest

# Install Git (required by the test harness and git-remote-mock)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# The mounted repo is owned by the host user (e.g. the CI runner's UID),
# which differs from the container user — git >= 2.35.2 refuses to read
# such a repo ("dubious ownership"). System-level config covers every
# container user and survives env-sanitized subprocess spawns.
RUN git config --system --add safe.directory /workspace

# /workspace — ADW repo root, mounted read-only at run time
# /tmp/bdd   — writable scratch space for fixture repos and mock artifacts
RUN mkdir -p /workspace /tmp/bdd

WORKDIR /workspace

# BDD_TAGS controls which Cucumber tag filter is applied.
# Defaults to @regression; override via -e BDD_TAGS=... at docker run.
ENV BDD_TAGS="@regression"
ENV TEST_RUNTIME="docker"

# Install dependencies from the mounted bun.lock, then run Cucumber.
# node_modules is written to a writable overlay volume mounted over
# /workspace/node_modules by the docker-run.sh wrapper script.
CMD ["sh", "-c", "bun install --frozen-lockfile && NODE_OPTIONS='--import tsx' bunx cucumber-js --tags \"${BDD_TAGS}\" --format progress"]
