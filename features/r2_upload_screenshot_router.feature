@adw-nnn7js-r2-upload-utility-sc
Feature: R2 upload utility and Screenshot Router Worker

  Two components for hosting review screenshots on Cloudflare R2:
  an R2 upload utility module that uploads images via the S3-compatible API,
  and a Cloudflare Worker that routes screenshot URLs to the correct bucket.

  # --- R2 Upload Utility Module ---

  Background:
    Given the ADW codebase is checked out

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: R2 upload utility module exists and exports an upload function
    Given the R2 upload utility module exists under "adws/"
    Then it exports a function that accepts an image buffer, owner, repo, and key
    And the function returns a public URL string

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: R2 upload utility uses S3-compatible API via @aws-sdk/client-s3
    Given the file "package.json" exists
    Then "@aws-sdk/client-s3" appears in the "dependencies" section
    And the R2 upload utility imports from "@aws-sdk/client-s3"

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: Bucket naming convention follows adw-{owner}-{repo} pattern
    Given the R2 upload utility module is read
    Then the bucket name is constructed using the pattern "adw-{owner}-{repo}"
    And the owner and repo segments are lowercased

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: 30-day object lifecycle rule is configured on bucket creation
    Given the R2 upload utility creates a new bucket
    When the bucket creation completes
    Then a lifecycle rule is configured with a 30-day expiration
    And the lifecycle rule applies to all objects in the bucket

  @adw-nnn7js-r2-upload-utility-sc
  Scenario: R2 upload utility reads credentials from environment variables
    Given the R2 upload utility module is read
    Then it reads "CLOUDFLARE_ACCOUNT_ID" from the environment
    And it reads "R2_ACCESS_KEY_ID" from the environment
    And it reads "R2_SECRET_ACCESS_KEY" from the environment

  @adw-nnn7js-r2-upload-utility-sc
  Scenario: R2 upload utility is reusable by any phase
    Given the R2 upload utility module is read
    Then it does not import or depend on any specific phase module
    And it accepts generic parameters without coupling to the review phase

  @adw-nnn7js-r2-upload-utility-sc
  Scenario: R2 upload utility configures S3 client with Cloudflare R2 endpoint
    Given the R2 upload utility module is read
    Then the S3 client is configured with the Cloudflare R2 endpoint URL
    And the endpoint includes the Cloudflare account ID

  # --- Screenshot Router Worker ---

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: Screenshot Router Worker source exists at workers/screenshot-router/
    Given the directory "workers/screenshot-router/" exists
    Then it contains a worker source file
    And the worker handles HTTP fetch requests

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: Worker routes requests to the correct R2 bucket based on URL path
    Given a request to "screenshots.paysdoc.nl/my-app/review-123/screenshot.png"
    When the Screenshot Router Worker handles the request
    Then it fetches the object from bucket "adw-paysdoc-my-app" with key "review-123/screenshot.png"

  @adw-nnn7js-r2-upload-utility-sc
  Scenario: Worker extracts repo and key from the URL path
    Given a request URL path "/my-app/some/nested/key.png"
    When the worker parses the URL
    Then the repo segment is "my-app"
    And the key segment is "some/nested/key.png"

  # --- wrangler.toml Configuration ---

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: wrangler.toml exists with correct configuration
    Given the file "workers/screenshot-router/wrangler.toml" exists
    Then it defines the worker name
    And it includes R2 bucket bindings
    And it includes a cron trigger configuration

  @adw-nnn7js-r2-upload-utility-sc
  Scenario: wrangler.toml cron trigger is configured for bucket cleanup
    Given the file "workers/screenshot-router/wrangler.toml" is read
    Then it contains a "[triggers]" section with a crons entry

  # --- .env.sample ---

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: .env.sample includes R2 credential placeholders
    Given the file ".env.sample" is read
    Then it contains "CLOUDFLARE_ACCOUNT_ID"
    And it contains "R2_ACCESS_KEY_ID"
    And it contains "R2_SECRET_ACCESS_KEY"
    And the R2 variables are marked as optional

  # --- Type Safety ---

  @adw-nnn7js-r2-upload-utility-sc @regression
  Scenario: TypeScript type-check passes with new modules
    Given the ADW codebase includes the R2 upload utility and worker modules
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
