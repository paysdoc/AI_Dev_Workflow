/**
 * A phase that parks the workflow ends its process with `process.exit(0)`. A scenario runs the phase in the cucumber process,
 * so it traps the exit: the park has written its state and posted its comment by then, and the trapped exit throws where
 * the process would have ended. No hooks and no steps: any step file may import it.
 */

export class TrappedExit extends Error {
  constructor(readonly exitCode: number) {
    super(`process.exit(${exitCode}) was called`);
  }
}

/**
 * Runs the work with `process.exit` replaced by a throw of `TrappedExit`, and puts the real one back afterwards.
 * `atExit` runs at the moment of the exit, before it is thrown: what the process would have left behind when it ended.
 */
export async function trappingExit<T>(work: () => Promise<T>, atExit: () => void = () => undefined): Promise<T> {
  const realExit = process.exit;
  process.exit = ((code?: number) => {
    atExit();
    throw new TrappedExit(code ?? 0);
  }) as typeof process.exit;
  try {
    return await work();
  } finally {
    process.exit = realExit;
  }
}
