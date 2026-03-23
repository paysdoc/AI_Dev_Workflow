@adw-3n5bwi-mock-infrastructure
Feature: Git remote mock intercepts network-touching git commands

  During behavioral testing, network-touching git commands (push, fetch, clone
  from remote) are intercepted and no-oped so tests run without real remotes.
  All local git operations (init, add, commit, branch, checkout, merge, diff)
  run for real against the local repository.

  Background:
    Given the git remote mock is activated in the test environment

  # --- Remote command interception ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git push is intercepted without errors
    Given a local git repository with at least one commit
    When "git push origin main" is executed
    Then the command exits with code 0
    And no network request is made to a remote server
    And stdout or stderr indicates the push was intercepted

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git fetch is intercepted without errors
    Given a local git repository
    When "git fetch origin" is executed
    Then the command exits with code 0
    And no network request is made to a remote server

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git clone from remote URL is intercepted without errors
    When "git clone https://github.com/test-owner/test-repo.git /tmp/test-clone" is executed
    Then the command exits with code 0
    And no network request is made to a remote server

  @adw-3n5bwi-mock-infrastructure
  Scenario: git push with force flag is intercepted
    Given a local git repository with at least one commit
    When "git push --force origin main" is executed
    Then the command exits with code 0
    And no network request is made to a remote server

  @adw-3n5bwi-mock-infrastructure
  Scenario: git fetch with specific branch is intercepted
    Given a local git repository
    When "git fetch origin feature-branch" is executed
    Then the command exits with code 0
    And no network request is made to a remote server

  # --- Local operations work normally ---

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git init works normally
    Given a temporary directory
    When "git init" is executed in the temporary directory
    Then a .git directory is created
    And the command exits with code 0

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git add and commit work normally
    Given a local git repository with a new file "test.txt"
    When "git add test.txt" is executed
    And "git commit -m 'test commit'" is executed
    Then the commit is created successfully
    And "git log --oneline" shows the new commit

  @adw-3n5bwi-mock-infrastructure @regression
  Scenario: git branch and checkout work normally
    Given a local git repository with at least one commit
    When "git branch feature-test" is executed
    And "git checkout feature-test" is executed
    Then the current branch is "feature-test"

  @adw-3n5bwi-mock-infrastructure
  Scenario: git merge works normally between local branches
    Given a local git repository with branches "main" and "feature-test"
    And "feature-test" has one commit ahead of "main"
    When "git checkout main" is executed
    And "git merge feature-test" is executed
    Then the merge completes without errors
    And "main" contains the commits from "feature-test"

  @adw-3n5bwi-mock-infrastructure
  Scenario: git diff works normally on local changes
    Given a local git repository with a modified file "test.txt"
    When "git diff" is executed
    Then the diff output shows the changes to "test.txt"

  @adw-3n5bwi-mock-infrastructure
  Scenario: git log works normally
    Given a local git repository with at least one commit
    When "git log --oneline" is executed
    Then the output lists the commit history

  # --- Mock mechanism ---

  @adw-3n5bwi-mock-infrastructure
  Scenario: Git remote mock uses a git wrapper or hook mechanism
    Given the git remote mock module exists in the test infrastructure
    Then it provides a mechanism to intercept git commands before they reach the network
    And the mechanism is transparent to the ADW workflow code

  @adw-3n5bwi-mock-infrastructure
  Scenario: Git remote mock can be enabled and disabled per test
    Given the git remote mock is activated
    When the mock is deactivated
    Then git push would attempt a real network connection
    When the mock is reactivated
    Then git push is intercepted again
