import { describe, it, expect } from 'vitest';
import { formatPRReviewWorkflowComment, PRReviewWorkflowContext } from '../github/workflowComments';
import { PRReviewWorkflowStage } from '../types/dataTypes';

describe('adwPrReview test integration', () => {
  const baseContext: PRReviewWorkflowContext = {
    issueNumber: 123,
    adwId: 'adw-1234567890-abc123',
    prNumber: 456,
    reviewComments: 3,
    branchName: 'feature/test-branch',
  };

  describe('PRReviewWorkflowStage type', () => {
    it('includes all test-related stages', () => {
      // Type check - these should compile without errors
      const testingStage: PRReviewWorkflowStage = 'pr_review_testing';
      const testFailedStage: PRReviewWorkflowStage = 'pr_review_test_failed';
      const testPassedStage: PRReviewWorkflowStage = 'pr_review_test_passed';
      const testMaxAttemptsStage: PRReviewWorkflowStage = 'pr_review_test_max_attempts';

      expect(testingStage).toBe('pr_review_testing');
      expect(testFailedStage).toBe('pr_review_test_failed');
      expect(testPassedStage).toBe('pr_review_test_passed');
      expect(testMaxAttemptsStage).toBe('pr_review_test_max_attempts');
    });
  });

  describe('formatPRReviewWorkflowComment', () => {
    describe('pr_review_testing stage', () => {
      it('formats testing started comment', () => {
        const comment = formatPRReviewWorkflowComment('pr_review_testing', baseContext);

        expect(comment).toContain('Running Validation Tests');
        expect(comment).toContain('Running validation tests before pushing changes');
        expect(comment).toContain(baseContext.adwId);
      });
    });

    describe('pr_review_test_failed stage', () => {
      it('formats test failed comment without attempt info', () => {
        const comment = formatPRReviewWorkflowComment('pr_review_test_failed', baseContext);

        expect(comment).toContain('Tests Failed');
        expect(comment).toContain('attempting automatic resolution');
        expect(comment).toContain(baseContext.adwId);
      });

      it('formats test failed comment with attempt info', () => {
        const contextWithAttempt: PRReviewWorkflowContext = {
          ...baseContext,
          testAttempt: 2,
          maxTestAttempts: 5,
        };

        const comment = formatPRReviewWorkflowComment('pr_review_test_failed', contextWithAttempt);

        expect(comment).toContain('Tests Failed');
        expect(comment).toContain('2/5');
        expect(comment).toContain(baseContext.adwId);
      });
    });

    describe('pr_review_test_passed stage', () => {
      it('formats test passed comment', () => {
        const comment = formatPRReviewWorkflowComment('pr_review_test_passed', baseContext);

        expect(comment).toContain('All Tests Passed');
        expect(comment).toContain('All validation tests passed');
        expect(comment).toContain(baseContext.adwId);
      });
    });

    describe('pr_review_test_max_attempts stage', () => {
      it('formats max attempts comment without failed tests', () => {
        const contextWithMaxAttempts: PRReviewWorkflowContext = {
          ...baseContext,
          maxTestAttempts: 5,
        };

        const comment = formatPRReviewWorkflowComment('pr_review_test_max_attempts', contextWithMaxAttempts);

        expect(comment).toContain('Tests Exceeded Maximum Retry Attempts');
        expect(comment).toContain('not** been pushed');
        expect(comment).toContain('5');
        expect(comment).toContain('Please review the failing tests manually');
        expect(comment).toContain(baseContext.adwId);
      });

      it('formats max attempts comment with failed tests list', () => {
        const contextWithFailedTests: PRReviewWorkflowContext = {
          ...baseContext,
          maxTestAttempts: 5,
          failedTests: ['test_login', 'test_checkout', 'test_payment'],
        };

        const comment = formatPRReviewWorkflowComment('pr_review_test_max_attempts', contextWithFailedTests);

        expect(comment).toContain('Tests Exceeded Maximum Retry Attempts');
        expect(comment).toContain('Failed tests:');
        expect(comment).toContain('- test_login');
        expect(comment).toContain('- test_checkout');
        expect(comment).toContain('- test_payment');
        expect(comment).toContain(baseContext.adwId);
      });
    });
  });

  describe('PRReviewWorkflowContext interface', () => {
    it('accepts test-related fields', () => {
      const contextWithTestFields: PRReviewWorkflowContext = {
        ...baseContext,
        testAttempt: 3,
        maxTestAttempts: 5,
        failedTests: ['test_one', 'test_two'],
      };

      expect(contextWithTestFields.testAttempt).toBe(3);
      expect(contextWithTestFields.maxTestAttempts).toBe(5);
      expect(contextWithTestFields.failedTests).toHaveLength(2);
    });

    it('test fields are optional', () => {
      // This should compile without errors - test fields are optional
      const contextWithoutTestFields: PRReviewWorkflowContext = baseContext;

      expect(contextWithoutTestFields.testAttempt).toBeUndefined();
      expect(contextWithoutTestFields.maxTestAttempts).toBeUndefined();
      expect(contextWithoutTestFields.failedTests).toBeUndefined();
    });
  });

  describe('workflow stage ordering', () => {
    it('test stages are positioned between implemented and committing', () => {
      // Verify the logical flow of stages by checking they all format correctly
      const stages: PRReviewWorkflowStage[] = [
        'pr_review_starting',
        'pr_review_planning',
        'pr_review_planned',
        'pr_review_implementing',
        'pr_review_implemented',
        'pr_review_testing',      // New: Tests start after implementation
        'pr_review_test_failed',  // New: Tests failed (during retry)
        'pr_review_test_passed',  // New: Tests passed
        'pr_review_committing',   // Only reached after tests pass
        'pr_review_pushed',
        'pr_review_completed',
      ];

      // Verify all stages can be formatted
      for (const stage of stages) {
        const comment = formatPRReviewWorkflowComment(stage, baseContext);
        expect(comment).toContain(baseContext.adwId);
        expect(comment.length).toBeGreaterThan(0);
      }
    });

    it('error stage formats correctly for test failures', () => {
      const contextWithError: PRReviewWorkflowContext = {
        ...baseContext,
        errorMessage: 'Tests failed after maximum retry attempts',
      };

      const comment = formatPRReviewWorkflowComment('pr_review_error', contextWithError);

      expect(comment).toContain('Tests failed after maximum retry attempts');
      expect(comment).toContain(baseContext.adwId);
    });
  });
});
