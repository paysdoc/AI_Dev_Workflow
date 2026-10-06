/** The ".adw/project.md" of a feature-991 scenario's repository, and the words the scenarios use for it. */

import assert from 'assert';

export const PROJECT_MD = '.adw/project.md';
export const APPLICATION_TYPE_SECTION = '## Application Type';

/** A step that names another file than the one it builds would otherwise read the scenario as if it had named this one. */
export function assertProjectMdFile(file: string): void {
  assert.strictEqual(file, PROJECT_MD, `The scenarios describe a repository in "${PROJECT_MD}"`);
}

export function assertApplicationTypeSection(section: string): void {
  assert.strictEqual(section, APPLICATION_TYPE_SECTION, `The section the scenarios leave out is "${APPLICATION_TYPE_SECTION}"`);
}

/** A project description as `adw_init` writes one: the application type section is there only when a type is given. */
export function projectMd(applicationType: string | null): string {
  const sections = [
    '# ADW Project Configuration',
    '## Project Overview\nA command-line tool that prints invoices.',
    ...(applicationType === null ? [] : [`${APPLICATION_TYPE_SECTION}\n\n${applicationType}`]),
    '## Framework Notes\nA TypeScript command-line tool run with Bun.',
  ];
  return `${sections.join('\n\n')}\n`;
}
