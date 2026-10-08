/**
 * The files a repository has of its own, which the framework upgrade must leave as they are: its manifest, its own
 * Playwright setup, and the cucumber-js feature and steps an older framework version had it write. They are text only:
 * they are written into a temporary repository, where nothing installs or runs them.
 */

const OWN_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify(
    { name: 'own-application', private: true, scripts: { dev: 'next dev', e2e: 'playwright test' }, devDependencies: { '@playwright/test': '1.40.0' } },
    null,
    2,
  )}\n`,
  'playwright.config.ts': [
    "import { defineConfig } from '@playwright/test';",
    '',
    "export default defineConfig({ testDir: 'e2e', webServer: { command: 'npm run dev', url: 'http://localhost:3000' } });",
    '',
  ].join('\n'),
  'e2e/home.spec.ts': [
    "import { expect, test } from '@playwright/test';",
    '',
    "test('the home page opens', async ({ page }) => {",
    "  await page.goto('/');",
    '  await expect(page).toHaveTitle(/Home/);',
    '});',
    '',
  ].join('\n'),
  'features/home.feature': ['Feature: The home page', '', '  Scenario: The home page opens', '    Given I am on the home page', ''].join('\n'),
  'features/step_definitions/home.steps.ts': [
    "import { Given } from '@cucumber/cucumber';",
    '',
    "Given('I am on the home page', function () {});",
    '',
  ].join('\n'),
};

export function ownFileContent(file: string): string {
  return OWN_FILES[file] ?? `// ${file}: a file of the repository's own.\n`;
}
