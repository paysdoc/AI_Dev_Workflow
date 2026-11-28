# Writing Step Definitions

You write every step definition the issue's scenarios need; no other agent writes them. A step left undefined fails the scenario test phase.

## Which runner

Read `## Application Type` in `.adw/project.md`:

- `web`: the scenarios run on ADW's Playwright project in `features/`, through `playwright-bdd`, under a configuration ADW owns. Follow **ADW's Playwright project** below.
- Any other type: the scenarios run on the runner `.adw/scenarios.md` names. Write the steps in the idiom of its `## BDD Framework` (registration of steps and hooks, file extension, pattern syntax, assertions) into its `## Step Def Directory`, which defaults to `features/step_definitions`. With no `## BDD Framework`, use the framework that the existing step definitions and the test dependencies already use. Do not assume another language or framework: the scenarios are always Gherkin `.feature` files, and only the step runtime varies. When `.adw/scenarios.md` has a `## Scenario Run Contract` section, also follow **Devices** below.

## Before writing

Read every existing step definition file the runner loads, whatever its extension: those in the step definition directory and those in any other step definition directory under the scenario directory, such as the ones beside the per-issue and regression scenarios. Reuse a step whose pattern already matches, and never register a pattern twice: the runner throws on a duplicate.

## ADW's Playwright project (`web`)

- Write TypeScript step definitions under `features/steps/`, which the configuration loads as `features/steps/**/*.ts`. Do this whatever `## BDD Framework` and `## Step Def Directory` say, and whatever language the application is written in.
- Register steps with `createBdd()` from `playwright-bdd`:
  ```ts
  import { expect } from '@playwright/test';
  import { createBdd } from 'playwright-bdd';

  const { Given, When, Then } = createBdd();

  Given('the home page is open', async ({ page }) => {
    await page.goto('/');
  });

  Then('the page shows the heading {string}', async ({ page }, heading: string) => {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  });
  ```
- A step receives Playwright's fixtures as its first argument and the step's parameters after it.
- Take the `page` fixture in every step that looks at or acts on what a user sees. The configuration captures an end-state screenshot of every scenario that uses `page`, and that image is the review's visual evidence. A step about pure logic or an HTTP API may take `request` instead.
- Navigate with paths relative to the application. ADW starts the dev server and gives its address to the configuration as `baseURL` (`ADW_APPLICATION_URL`). Never hard-code a host or port, start a server, or add a `webServer` block.
- Use Cucumber-expression patterns (`{string}`, `{int}`) and `expect` from `@playwright/test`.
- Never edit `features/playwright.config.ts` or `features/.gitignore`; ADW owns them.
- The mock infrastructure of **Test Harness Awareness** in [SKILL.md](SKILL.md) belongs to the other runners and does not apply here.
- Check the steps with `cd features && (test -d node_modules || npm ci) && npx bddgen`. `bddgen` loads the steps as the runner does and fails on an undefined or duplicate step. Never run `npx bddgen` without the install guard in front of it: a worktree has no `features/node_modules`, and `npx` would resolve the name on the npm registry without asking.

## Devices (`## Scenario Run Contract`)

When `.adw/scenarios.md` has a `## Scenario Run Contract` section, the scenarios drive the application on an Android emulator and an iOS simulator that ADW creates and boots for each run. The step definitions and their hooks keep to that contract:

- The run receives the devices in its environment: `ADW_ANDROID_SERIAL`, the emulator's `adb` serial, and `ADW_IOS_UDID`, the simulator's UDID (`ADW_ANDROID_AVD` names the emulator's AVD). Point each platform's session at its device through these variables. Never hard-code a device, and never create, boot, shut down or delete one: ADW does.
- Write every screenshot under the directory in `ADW_PROOF_DIR`: in its `android/` directory for an image taken on Android, in its `ios/` directory for one taken on iOS, for example `$ADW_PROOF_DIR/android/<name>.png`. ADW reads the platform of an image from that first directory, and never shows the reviewer an image that lies anywhere else.
- End every scenario about something a user sees with a screenshot on each platform, and name each image the way the contract says.

Without the section, the run receives no device, and a screenshot needs no platform directory.

## Checking the steps

Never import, load or run a step definition file outside the runner to check it, whatever the framework. A step definition file registers its steps when it loads, and the runner throws a registration error outside a running session; a dynamic import, a heredoc or a pipeline can also leave children alive after the module errors out. Check the steps with the language's static syntax or type check, or with the scenario run itself. `bddgen` is the one exception: it loads the steps as the runner does.
