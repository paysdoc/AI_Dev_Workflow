# python-app — ADW hermetic e2e fixture

This directory is a minimal Python/pytest-bdd target repo used by ADW's `@regression` end-to-end test. It verifies the non-TypeScript pipeline (detect → run → JUnit parse → image harvest → proof comment) without requiring a Python interpreter.

The `.adw/commands.md` "Run Scenarios by Tag" command is a portable POSIX shell stand-in for a real `pytest-bdd` run: it writes a valid JUnit XML report to `$ADW_JUNIT_REPORT_PATH` and copies `features/steps/assets/proof.png` into `$ADW_PROOF_DIR/calculator/`. The Docker runner ships Bun and Git, not Python; the hermetic command produces the same artefacts that ADW consumes.
