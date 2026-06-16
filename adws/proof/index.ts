/**
 * Proof layer module — barrel export.
 *
 * Provides utilities for harvesting BDD screenshot artifacts and publishing
 * a proof comment to the pull request.
 */

export { harvestProofArtifacts } from './proofArtifactHarvester';
export { formatPrProofComment, publishPrProof } from './prProofPublisher';
export type {
  ProofArtifact,
  UploadedArtifact,
  ProofCommentInput,
  PublishDeps,
  TagProofResultLike,
  UploaderFn,
  CommenterFn,
} from './types';
