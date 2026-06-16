@regression @python-e2e
Feature: Python fixture driven end-to-end — detect → run → JUnit parse → image harvest → proof comment

  This scenario is the multi-language pipeline guard specified in the PRD
  (User Story 28, Testing Decisions). It drives ADW's real pipeline modules
  in-process against an isolated copy of `test/fixtures/python-app/` and asserts
  the observable output of each stage. No Python interpreter, network, R2, or
  GitHub is required — the fixture's POSIX-shell run command emits the same
  artefacts that a real pytest-bdd run would produce.

  Vocabulary: see features/regression/vocabulary.md §Given/When/Then — Python Fixture E2E.

  Scenario: ADW non-TypeScript pipeline executes end-to-end against the Python fixture
    Given the Python fixture target "python-app" is initialised as an ADW target repo
    When ADW runs the scenario proof pipeline against the Python fixture for issue 583
    Then the scenario proof for the Python fixture is not skipped
    And the scenario proof reports 2 passed and 0 failed
    And the scenario proof records no blocker failures
    And the proof run harvests at least 1 screenshot artifact
    And the composed proof comment shows the pass tally and an inline screenshot
    And publishing the proof posts a PR comment carrying the pass tally
