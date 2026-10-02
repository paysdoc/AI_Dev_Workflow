/**
 * What the mounts of a `docker run` say, read against the checkout of the job that made it. A
 * target is a path inside the container. A path of the checkout compares after resolving links, so
 * a checkout under a symlinked temporary directory is still the checkout, and a source that does
 * not exist yet is resolved as far as it does.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DockerMount } from './feature-962-docker.ts';

const containerPath = (target: string): string => path.posix.resolve('/', target);

/** `candidate` resolved through links as far as it exists, then the rest of it as written. */
function resolveExisting(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return path.join(resolveExisting(path.dirname(absolute)), path.basename(absolute));
  }
}

const isWithin = (relative: string): boolean => !relative.startsWith('..') && !path.isAbsolute(relative);

/** A bind mount of the checkout itself, read-only, at `target`. */
export function mountsCheckoutReadOnlyAt(mount: DockerMount, checkoutDir: string, target: string): boolean {
  if (mount.type !== 'bind' || mount.source === null || !mount.readOnly) return false;
  return containerPath(mount.target) === containerPath(target) && resolveExisting(mount.source) === fs.realpathSync(checkoutDir);
}

/** A volume with no source, which Docker makes for the container alone. */
export function isAnonymousVolumeOver(mount: DockerMount, target: string): boolean {
  return mount.type === 'volume' && mount.source === null && containerPath(mount.target) === containerPath(target);
}

/** A writable mount at or below `root`, except the anonymous volume over `exempt`. */
export function isOtherWritableMountUnder(mount: DockerMount, root: string, exempt: string): boolean {
  const inside = isWithin(path.posix.relative(containerPath(root), containerPath(mount.target)));
  return inside && !mount.readOnly && !isAnonymousVolumeOver(mount, exempt);
}

/** A writable bind mount whose source is the checkout, or lies inside it. */
export function isWritableBindOfCheckout(mount: DockerMount, checkoutDir: string): boolean {
  if (mount.type !== 'bind' || mount.source === null || mount.readOnly) return false;
  return isWithin(path.relative(fs.realpathSync(checkoutDir), resolveExisting(mount.source)));
}

export function describeMount(mount: DockerMount): string {
  const kind = mount.source === null ? `anonymous ${mount.type}` : `${mount.type} from ${mount.source}`;
  return `${kind} at ${mount.target} (${mount.readOnly ? 'read-only' : 'writable'})`;
}
