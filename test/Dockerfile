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

# /workspace — ADW repo root, mounted read-only at run time
# /tmp/bdd   — writable scratch space; the suite runs in a copy of /workspace at /tmp/bdd/workspace
RUN mkdir -p /workspace /tmp/bdd

WORKDIR /workspace

# BDD_TAGS controls which Cucumber tag filter is applied.
# Defaults to @regression; override via -e BDD_TAGS=... at docker run.
ENV BDD_TAGS="@regression"
ENV TEST_RUNTIME="docker"

# ADW writes its runtime state (agents/, logs/) under the working directory, so the suite runs in a
# writable copy of the read-only mount. cp -R, not -a: the copy must belong to the container user, or
# git refuses it as a repository of dubious ownership. docker-run.sh overlays /workspace/node_modules
# with an empty volume, so the host's modules stay out of the copy.
CMD ["sh", "-c", "cp -R /workspace/. /tmp/bdd/workspace && cd /tmp/bdd/workspace && bun install --frozen-lockfile && NODE_OPTIONS='--import tsx' bunx cucumber-js --tags \"${BDD_TAGS}\" --format progress"]
