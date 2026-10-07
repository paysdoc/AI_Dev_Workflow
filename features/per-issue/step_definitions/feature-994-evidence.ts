/**
 * How the feature-994 Then steps tell which images a comment, the screenshot store and the review agent's proof show. An image
 * is told by its bytes, which the stand-in scenario runner makes unique to its file name. No hooks and no steps.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { imageBytes } from './feature-994-runner.ts';
import { requireStore, s, type ProofReceived, type RecordedComment } from './feature-994-world.ts';

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp)\b/i;

/** The sources of the images a comment embeds, as markdown. */
export function imageSources(body: string): string[] {
  return [...body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(match => match[1].trim());
}

function urlsReturnedFor(imageName: string): string[] {
  const bytes = imageBytes(imageName);
  return requireStore().uploads.flatMap(upload => (upload.url !== null && upload.bytes.equals(bytes) ? [upload.url] : []));
}

/** Every listed image is embedded from a URL the store returned for it, and nothing else is embedded. */
export function assertShowsExactly(bodies: readonly string[], listed: readonly string[], where: string): void {
  const sources = bodies.flatMap(imageSources);
  const notEmbedded = listed.filter(name => !urlsReturnedFor(name).some(url => sources.includes(url)));
  assert.deepStrictEqual(notEmbedded, [], `Expected ${where} to embed every listed image from a URL the screenshot store returned for it. Image sources: ${JSON.stringify(sources)}\n${bodies.join('\n---\n')}`);

  const allowed = listed.flatMap(urlsReturnedFor);
  const unexpected = sources.filter(source => !allowed.includes(source));
  assert.deepStrictEqual(unexpected, [], `Expected ${where} to embed no image but the listed ones.\n${bodies.join('\n---\n')}`);
}

/** The images the store received, each once however often it was uploaded, by the name the stand-in runner gave the file. */
export function distinctImagesReceived(): string[] {
  const listed = new Set<string>();
  for (const { bytes } of requireStore().uploads) listed.add(bytes.toString());
  return [...listed];
}

export function expectedImageBytes(names: readonly string[]): string[] {
  return names.map(name => imageBytes(name).toString());
}

// The first `## ` line is the heading of a comment; the review comments carry an emoji shortcode before the title.
function headingOf(body: string): string {
  return body.split('\n').find(line => line.startsWith('## ')) ?? '';
}

export function lastCommentHeaded(comments: readonly RecordedComment[], number: number, heading: string): RecordedComment {
  const onThread = comments.filter(comment => comment.number === number);
  const matching = onThread.filter(comment => headingOf(comment.body).includes(heading));
  assert.ok(
    matching.length > 0,
    `Expected ${number} to have received a comment headed "${heading}"; its comments were headed: ${onThread.map(comment => headingOf(comment.body)).join(' | ') || '(none)'}`,
  );
  return matching[matching.length - 1];
}

/** The absolute paths the proof's Evidence section lists, which is how the review agent is told where the images are. */
export function evidencePaths(document: string): string[] {
  const [, evidence] = document.split('\n## Evidence');
  if (evidence === undefined) return [];
  return [...evidence.matchAll(/^- `.*`: (.+)$/gm)].map(match => match[1].trim());
}

export function lastProofReceived(): ProofReceived {
  const received = s.reviewed[s.reviewed.length - 1];
  assert.ok(received, 'Expected the review phase to have judged a proof first');
  return received;
}

export function mentionsAnImageFile(document: string): boolean {
  return IMAGE_FILE.test(document);
}

export function assertImagesCanBeOpened(paths: readonly string[]): void {
  for (const imagePath of paths) {
    assert.ok(path.isAbsolute(imagePath), `Expected the proof to give the absolute path of an image, but it gives "${imagePath}"`);
    assert.ok(fs.existsSync(imagePath), `Expected the image "${imagePath}" the proof lists to exist`);
  }
}
