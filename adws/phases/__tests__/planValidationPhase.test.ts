import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core")>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      initializeState: vi.fn().mockReturnValue("/mock/state/validation-agent"),
      writeState: vi.fn(),
      appendLog: vi.fn(),
      createExecutionState: vi.fn().mockReturnValue({ status: "running", startedAt: "2025-01-01" }),
      completeExecution: vi.fn().mockReturnValue({ status: "completed", startedAt: "2025-01-01" }),
    },
    MAX_VALIDATION_RETRY_ATTEMPTS: 3,
    emptyModelUsageMap: actual.emptyModelUsageMap,
    mergeModelUsageMaps: actual.mergeModelUsageMaps,
  };
});

vi.mock("../../github/workflowCommentsIssue", () => ({
  formatWorkflowComment: vi.fn().mockReturnValue("formatted comment"),
}));

const mockRunValidationAgent = vi.fn();
const mockRunResolutionAgent = vi.fn();
const mockFindScenarioFiles = vi.fn();
const mockReadScenarioContents = vi.fn();
const mockReadPlanFile = vi.fn();
const mockGetPlanFilePath = vi.fn().mockReturnValue("specs/issue-42-plan.md");
const mockRunCommitAgent = vi.fn().mockResolvedValue({ success: true, output: "", commitMessage: "commit" });
const mockFormatIssueContextAsArgs = vi.fn().mockReturnValue("## GitHub Issue #42");

vi.mock("../../agents", () => ({
  runValidationAgent: mockRunValidationAgent,
  runResolutionAgent: mockRunResolutionAgent,
  findScenarioFiles: mockFindScenarioFiles,
  readScenarioContents: mockReadScenarioContents,
  readPlanFile: mockReadPlanFile,
  getPlanFilePath: mockGetPlanFilePath,
  runCommitAgent: mockRunCommitAgent,
}));

vi.mock("../../agents/planAgent", () => ({
  formatIssueContextAsArgs: mockFormatIssueContextAsArgs,
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
}));

import { executePlanValidationPhase } from "../planValidationPhase";
import type { WorkflowConfig } from "../workflowLifecycle";
import type { RecoveryState, GitHubIssue } from "../../core";
import type { WorkflowContext } from "../../github";
import { makeRepoContext, type MockRepoContext } from "./helpers/makeRepoContext";

let repoContext: MockRepoContext;

const mockModelUsage = {
  "claude-opus-4-20250514": {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0.5,
  },
};

function makeAlignedValidation() {
  return {
    success: true,
    output: '{"aligned": true, "mismatches": [], "summary": "All aligned"}',
    totalCostUsd: 0.5,
    modelUsage: mockModelUsage,
    validationResult: { aligned: true, mismatches: [], summary: "All aligned" },
  };
}

function makeMismatchedValidation(attempt = 1) {
  return {
    success: true,
    output: '{"aligned": false, "mismatches": [{"type": "plan_only", "description": "Missing scenario"}], "summary": "Mismatch found"}',
    totalCostUsd: 0.5,
    modelUsage: mockModelUsage,
    validationResult: {
      aligned: false,
      mismatches: [{ type: "plan_only" as const, description: `Missing scenario (attempt ${attempt})` }],
      summary: "Mismatch found",
    },
  };
}

function makeResolution() {
  return {
    success: true,
    output: '{"reasoning": "Updated plan", "decision": "plan_updated"}',
    totalCostUsd: 0.8,
    modelUsage: mockModelUsage,
    resolutionResult: {
      updatedPlan: "Updated plan content",
      reasoning: "Updated plan to align with scenarios",
      decision: "plan_updated" as const,
    },
  };
}

function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    issueNumber: 42,
    adwId: "adw-test-abc123",
    issue: {
      number: 42,
      title: "Test issue",
      body: "Issue body",
      state: "OPEN",
      author: { login: "alice", name: null, isBot: false },
      assignees: [],
      labels: [],
      milestone: null,
      comments: [],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
      closedAt: null,
      url: "https://github.com/o/r/issues/42",
    } as GitHubIssue,
    issueType: "/feature",
    worktreePath: "/mock/worktree",
    defaultBranch: "main",
    logsDir: "/mock/logs",
    orchestratorStatePath: "/mock/state/orchestrator",
    orchestratorName: "test-orchestrator",
    recoveryState: {
      lastCompletedStage: null,
      adwId: null,
      branchName: null,
      planPath: null,
      prUrl: null,
      canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: "adw-test-abc123" } as WorkflowContext,
    branchName: "feat-issue-42-test",
    applicationUrl: "http://localhost:3000",
    projectConfig: { commands: {} } as any,
    repoContext,
    ...overrides,
  };
}

describe("executePlanValidationPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();

    mockReadPlanFile.mockReturnValue("# Plan content");
    mockFindScenarioFiles.mockReturnValue(["/mock/worktree/features/login.feature"]);
    mockReadScenarioContents.mockReturnValue("Feature: Login\n  Scenario: ...");
  });

  it("returns cost and model usage when plan and scenarios are aligned on first check", async () => {
    mockRunValidationAgent.mockResolvedValue(makeAlignedValidation());

    const result = await executePlanValidationPhase(makeConfig());

    expect(result.costUsd).toBe(0.5);
    expect(result.modelUsage["claude-opus-4-20250514"].inputTokens).toBe(100);
    expect(mockRunResolutionAgent).not.toHaveBeenCalled();
    expect(mockRunCommitAgent).not.toHaveBeenCalled();
  });

  it("posts plan_validating and plan_validated stage comments when aligned", async () => {
    mockRunValidationAgent.mockResolvedValue(makeAlignedValidation());

    await executePlanValidationPhase(makeConfig());

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, "formatted comment");
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledTimes(2);
  });

  it("gracefully skips when no scenario files are found", async () => {
    mockFindScenarioFiles.mockReturnValue([]);

    const result = await executePlanValidationPhase(makeConfig());

    expect(result.costUsd).toBe(0);
    expect(result.modelUsage).toEqual({});
    expect(mockRunValidationAgent).not.toHaveBeenCalled();
    expect(mockRunResolutionAgent).not.toHaveBeenCalled();
  });

  it("logs skipped info when no scenario files found", async () => {
    mockFindScenarioFiles.mockReturnValue([]);
    const { AgentStateManager: asm } = await import("../../core");

    await executePlanValidationPhase(makeConfig());

    expect(asm.appendLog).toHaveBeenCalledWith(
      "/mock/state/orchestrator",
      "Plan validation skipped: no scenario files found"
    );
  });

  it("resolves mismatch in one attempt and returns accumulated cost", async () => {
    mockRunValidationAgent
      .mockResolvedValueOnce(makeMismatchedValidation())
      .mockResolvedValueOnce(makeAlignedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    const result = await executePlanValidationPhase(makeConfig());

    expect(mockRunResolutionAgent).toHaveBeenCalledTimes(1);
    expect(result.costUsd).toBe(0.5 + 0.8 + 0.5); // initial + resolution + re-validation
    expect(mockRunCommitAgent).toHaveBeenCalledTimes(1);
  });

  it("posts plan_resolving and plan_resolved stage comments during resolution", async () => {
    mockRunValidationAgent
      .mockResolvedValueOnce(makeMismatchedValidation())
      .mockResolvedValueOnce(makeAlignedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    await executePlanValidationPhase(makeConfig());

    // plan_validating + plan_resolving + plan_resolved + plan_validated = 4 comments
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledTimes(4);
  });

  it("throws an error after MAX_VALIDATION_RETRY_ATTEMPTS exhausted", async () => {
    mockRunValidationAgent.mockResolvedValue(makeMismatchedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    await expect(executePlanValidationPhase(makeConfig())).rejects.toThrow(
      /Plan validation failed after 3 resolution attempts/
    );

    expect(mockRunResolutionAgent).toHaveBeenCalledTimes(3);
  });

  it("posts plan_validation_failed comment after max retries exhausted", async () => {
    mockRunValidationAgent.mockResolvedValue(makeMismatchedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    await expect(executePlanValidationPhase(makeConfig())).rejects.toThrow();

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, "formatted comment");
  });

  it("logs resolution reasoning to ADW state", async () => {
    mockRunValidationAgent
      .mockResolvedValueOnce(makeMismatchedValidation())
      .mockResolvedValueOnce(makeAlignedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());
    const { AgentStateManager: asm } = await import("../../core");

    await executePlanValidationPhase(makeConfig());

    expect(asm.appendLog).toHaveBeenCalledWith(
      "/mock/state/orchestrator",
      expect.stringContaining("Resolution 1 reasoning:")
    );
  });

  it("accumulates model usage across multiple agent calls", async () => {
    mockRunValidationAgent
      .mockResolvedValueOnce(makeMismatchedValidation())
      .mockResolvedValueOnce(makeAlignedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    const result = await executePlanValidationPhase(makeConfig());

    // 3 agent calls each with 100 input tokens
    expect(result.modelUsage["claude-opus-4-20250514"].inputTokens).toBe(300);
  });

  it("does not commit when plan is already aligned on first check", async () => {
    mockRunValidationAgent.mockResolvedValue(makeAlignedValidation());

    await executePlanValidationPhase(makeConfig());

    expect(mockRunCommitAgent).not.toHaveBeenCalled();
  });

  it("commits artifacts after successful resolution", async () => {
    mockRunValidationAgent
      .mockResolvedValueOnce(makeMismatchedValidation())
      .mockResolvedValueOnce(makeAlignedValidation());
    mockRunResolutionAgent.mockResolvedValue(makeResolution());

    await executePlanValidationPhase(makeConfig());

    expect(mockRunCommitAgent).toHaveBeenCalledWith(
      "validation-agent",
      "/feature",
      expect.any(String),
      "/mock/logs",
      undefined,
      "/mock/worktree",
      "Issue body"
    );
  });

  it("throws error when plan file cannot be read", async () => {
    mockReadPlanFile.mockReturnValue(null);

    await expect(executePlanValidationPhase(makeConfig())).rejects.toThrow(
      /Cannot read plan file/
    );
  });
});
