@adw-872 @adw-xchzuc-chore-comment-sweep
Feature: The features/per-issue batch-4 comment sweep changes only comments in its touched files

  Issue #872 sweeps low-value comments out of 13 files under features/per-issue/ (3 feature
  files, 10 TypeScript step-definition/support files). The comment-only guard proves the sweep
  touched nothing but comments and the blank lines their removal left behind.

  @adw-872 @adw-xchzuc-chore-comment-sweep
  Scenario: The comment-only guard reports no violations for the batch's touched files
    Given the files touched by this comment sweep batch
    When the comment-only guard checks those files against the default branch
    Then the comment-only guard run reports no violations
