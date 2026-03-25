@adw-278
Feature: Application type config and screenshot upload in review comments

  ADW supports an application type setting in `.adw/project.md` with values
  `cli` or `web`. When the type is `web`, the review phase uploads screenshots
  to Cloudflare R2 and embeds them as linked images in the issue proof comment.
  When the type is `cli`, screenshot upload is skipped entirely.

  Background:
    Given the ADW codebase is at the current working directory

  # --- .adw/project.md Application Type section ---

  @adw-278 @regression
  Scenario: project.md supports Application Type section with cli value
    Given the file ".adw/project.md" exists
    When the file is read
    Then it contains a "## Application Type" section
    And the value under that section is "cli"

  @adw-278 @regression
  Scenario: project.md Application Type section accepts web value
    Given a ".adw/project.md" file with "## Application Type" set to "web"
    When projectConfig loads the file
    Then the application type is exposed as "web"

  @adw-278 @regression
  Scenario: project.md Application Type defaults to cli when section is absent
    Given a ".adw/project.md" file without an "## Application Type" section
    When projectConfig loads the file
    Then the application type defaults to "cli"

  # --- projectConfig.ts loading ---

  @adw-278 @regression
  Scenario: ProjectConfig interface includes applicationType field
    Given "adws/core/projectConfig.ts" is read
    When the "ProjectConfig" interface definition is found
    Then the interface contains an "applicationType" field
    And the field type accepts "cli" or "web" values

  @adw-278
  Scenario: parseProjectMd extracts application type from project.md content
    Given a ".adw/project.md" file with "## Application Type" set to "web"
    When the project.md content is parsed
    Then the returned applicationType is "web"

  @adw-278
  Scenario: loadProjectConfig returns applicationType from .adw/project.md
    Given a target repository with ".adw/project.md" containing "## Application Type\nweb"
    When loadProjectConfig is called for that repository
    Then the returned ProjectConfig has applicationType set to "web"

  # --- /adw_init inference ---

  @adw-278 @regression
  Scenario: adw_init.md instruction includes Application Type section generation
    Given the file ".claude/commands/adw_init.md" is read
    When the step that defines sections for ".adw/project.md" generation is found
    Then the instruction lists "## Application Type" as a section to generate
    And the instruction describes inferring the value from the target codebase

  @adw-278
  Scenario: adw_init infers web type for projects with frontend frameworks
    Given a target repository with "next" in package.json dependencies
    When adw_init analyzes the project
    Then the generated ".adw/project.md" contains "## Application Type" with value "web"

  @adw-278
  Scenario: adw_init infers cli type for projects without frontend frameworks
    Given a target repository with no frontend framework dependencies
    And no dev server configuration files
    When adw_init analyzes the project
    Then the generated ".adw/project.md" contains "## Application Type" with value "cli"

  # --- Review phase screenshot upload for web type ---

  @adw-278 @regression
  Scenario: Review phase uploads screenshots to R2 when application type is web
    Given a workflow with application type "web"
    And the review phase completes with screenshots in allScreenshots
    When the workflow completion runs
    Then each screenshot file is uploaded to R2 via the upload utility
    And the upload returns public URLs for each screenshot

  @adw-278 @regression
  Scenario: Screenshot URLs are embedded as linked images in the issue proof comment
    Given a workflow with application type "web"
    And screenshots have been uploaded to R2 with public URLs
    When the proof comment is formatted
    Then the comment contains markdown image links for each screenshot URL
    And the screenshot images appear between the review summary and scenario proof table

  @adw-278
  Scenario: Screenshot upload uses the R2 upload utility with correct parameters
    Given a workflow with application type "web"
    And the review produces screenshots at known file paths
    When the screenshot upload runs
    Then uploadToR2 is called with the repo owner, repo name, and a unique key per screenshot
    And the content type is set to an image MIME type

  # --- Screenshot upload skipped for cli type ---

  @adw-278 @regression
  Scenario: Screenshot upload is skipped when application type is cli
    Given a workflow with application type "cli"
    And the review phase completes with screenshots in allScreenshots
    When the workflow completion runs
    Then no R2 upload calls are made
    And the proof comment contains no image links

  @adw-278
  Scenario: Proof comment for cli type contains only review summary and scenario proof
    Given a workflow with application type "cli"
    When the proof comment is formatted
    Then the comment contains the review summary section
    And the comment contains the scenario proof table
    And the comment does not contain any markdown image links

  # --- Proof Comment Formatter ---

  @adw-278 @regression
  Scenario: Proof comment formatter accepts optional screenshotUrls parameter
    Given the proof comment formatting function exists
    When called with an array of screenshot URLs
    Then it renders each URL as a linked markdown image
    And when called without screenshot URLs it renders no image section

  @adw-278
  Scenario: Proof comment formatter renders screenshots in correct position
    Given a review summary and scenario proof data
    And an array of screenshot URLs
    When the proof comment is formatted
    Then the screenshot images section appears after the review summary
    And the screenshot images section appears before the scenario proof table

  # --- Backward compatibility ---

  @adw-278 @regression
  Scenario: Existing cli workflows including ADW itself are unaffected
    Given the ADW project ".adw/project.md" has "## Application Type" set to "cli"
    When the ADW workflow runs its review phase
    Then no screenshot upload is attempted
    And the workflow completes successfully without R2 credentials

  @adw-278
  Scenario: Missing R2 credentials do not break cli-type workflows
    Given a workflow with application type "cli"
    And R2 environment variables are not set
    When the review phase completes
    Then the workflow completes successfully
    And no error is raised about missing R2 credentials

  # --- Edge cases ---

  @adw-278
  Scenario: Non-image files in allScreenshots are filtered out before upload
    Given a workflow with application type "web"
    And the review phase completes with allScreenshots containing "screenshot.png", "proof.md", and "capture.jpg"
    When the screenshot upload runs
    Then only "screenshot.png" and "capture.jpg" are uploaded to R2
    And "proof.md" is not uploaded

  @adw-278
  Scenario: Application type value is normalized to lowercase and trimmed
    Given a ".adw/project.md" file with "## Application Type" set to "  Web  "
    When projectConfig loads the file
    Then the application type is exposed as "web"

  @adw-278
  Scenario: Empty allScreenshots for web type skips upload gracefully
    Given a workflow with application type "web"
    And the review phase completes with no screenshots in allScreenshots
    When the workflow completion runs
    Then no R2 upload calls are made
    And no error is raised

  @adw-278
  Scenario: Non-existent screenshot file path is skipped with a warning
    Given a workflow with application type "web"
    And allScreenshots contains a path to a file that does not exist on disk
    When the screenshot upload runs
    Then a warning is logged for the missing file
    And the remaining valid screenshots are uploaded successfully

  # --- Type safety ---

  @adw-278 @regression
  Scenario: TypeScript type-check passes with application type changes
    Given the ADW codebase includes the application type changes
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
