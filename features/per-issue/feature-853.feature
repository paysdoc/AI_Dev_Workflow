@adw-853 @adw-m363ky-chore-comment-discip
Feature: Comment-only guard normalises TypeScript and Gherkin sources to their non-trivia content

  @adw-853 @adw-m363ky-chore-comment-discip
  Scenario: A TypeScript pair differing only in comments, blank lines, and JSDoc normalises equal
    Given a TypeScript source with a JSDoc block, line comments, a block comment, and blank lines
    And the same TypeScript source with every comment and blank line stripped
    When both sources are normalised as "ts"
    Then their normalised forms are equal

  @adw-853 @adw-m363ky-chore-comment-discip
  Scenario: A TypeScript pair with one changed token normalises unequal and the report names the file
    Given the current version of "adws/example.ts" and its base version differing by one identifier
    When the comment-only guard checks that file pair against base ref "origin/dev"
    Then the guard reports "adws/example.ts" as changed beyond comments

  @adw-853 @adw-m363ky-chore-comment-discip
  Scenario: A feature-file pair differing only in comment lines normalises equal
    Given a feature file source with "#" comment lines interspersed between steps
    And the same feature file source with every "#" comment line removed
    When both sources are normalised as "feature"
    Then their normalised forms are equal

  @adw-853 @adw-m363ky-chore-comment-discip
  Scenario: A feature-file pair with a changed step line normalises unequal
    Given a feature file source
    And the same feature file source with one step's text changed
    When both sources are normalised as "feature"
    Then their normalised forms are unequal

  @adw-853 @adw-m363ky-chore-comment-discip
  Scenario: Removing a mid-line "#" from a step changes the normalised form
    Given a feature file source containing a step with a "#" in the middle of its text
    And the same feature file source with that mid-line "#" removed
    When both sources are normalised as "feature"
    Then their normalised forms are unequal
