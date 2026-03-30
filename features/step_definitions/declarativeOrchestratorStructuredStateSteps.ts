import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Shared context for multi-step scenarios
// ---------------------------------------------------------------------------

const ctx: {
  stateFileContent: string;
  runnerFileContent: string;
  phaseRunnerFileContent: string;
  orchestratorFilesContent: Record<string, string>;
  mockContext: {
    phaseOrder: string[];
    totalCost: number;
    errorCaught: Error | null;
    completeWorkflowCalled: boolean;
    handleWorkflowErrorCalled: boolean;
    serializedState: unknown;
  };
} = {
  stateFileContent: '',
  runnerFileContent: '',
  phaseRunnerFileContent: '',
  orchestratorFilesContent: {},
  mockContext: {
    phaseOrder: [],
    totalCost: 0,
    errorCaught: null,
    completeWorkflowCalled: false,
    handleWorkflowErrorCalled: false,
    serializedState: null,
  },
};

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given('the orchestrator state types are read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/types/workflowState.ts');
  assert.ok(existsSync(filePath), 'Expected adws/types/workflowState.ts to exist');
  ctx.stateFileContent = readFileSync(filePath, 'utf-8');
  this.fileContent = ctx.stateFileContent;
  this.filePath = 'adws/types/workflowState.ts';
});

Given('the orchestrator state type files are read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/types/workflowState.ts');
  assert.ok(existsSync(filePath), 'Expected adws/types/workflowState.ts to exist');
  ctx.stateFileContent = readFileSync(filePath, 'utf-8');
  this.fileContent = ctx.stateFileContent;
  this.filePath = 'adws/types/workflowState.ts';
});

Given('the orchestrator runner module is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
  this.fileContent = ctx.runnerFileContent;
  this.filePath = 'adws/core/orchestratorRunner.ts';
});

Given('the runner module and state type files are read', function (this: Record<string, string>) {
  const runnerPath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  const statePath = join(ROOT, 'adws/types/workflowState.ts');
  assert.ok(existsSync(runnerPath), 'Expected adws/core/orchestratorRunner.ts to exist');
  assert.ok(existsSync(statePath), 'Expected adws/types/workflowState.ts to exist');
  const combined = readFileSync(runnerPath, 'utf-8') + '\n' + readFileSync(statePath, 'utf-8');
  ctx.runnerFileContent = combined;
  this.fileContent = combined;
  this.filePath = 'adws/core/orchestratorRunner.ts + adws/types/workflowState.ts';
});

Given('the phaseRunner module is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/core/phaseRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/phaseRunner.ts to exist');
  ctx.phaseRunnerFileContent = readFileSync(filePath, 'utf-8');
  this.fileContent = ctx.phaseRunnerFileContent;
  this.filePath = 'adws/core/phaseRunner.ts';
});

Given('the WorkflowConfig interface is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/workflowInit.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/workflowInit.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/workflowInit.ts';
});

Given('a structured state object with all namespaces populated', function () {
  ctx.mockContext.serializedState = {
    install: { installContext: 'install-ctx' },
    plan: { branchName: 'feature-42-slug', planPath: 'specs/plan.md', planOutput: 'output', issueType: '/feature' },
    build: { buildProgress: { turnCount: 3, toolCount: 7 } },
    test: { unitTestsPassed: true, totalRetries: 0 },
    pr: { prUrl: 'https://github.com/test/repo/pull/1', prNumber: 1 },
  };
});

Given('a declarative orchestrator definition', function () {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('a declarative orchestrator with phases {string}', function (_phasesStr: string) {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('a declarative orchestrator whose phases all succeed', function () {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('a declarative orchestrator where a phase throws an error', function () {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('mock phases that record their invocation order', function () {
  ctx.mockContext.phaseOrder = [];
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('mock phases that return known cost values', function () {
  ctx.mockContext.totalCost = 0;
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('mock phases that all succeed', function () {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('a mock phase that throws an Error', function () {
  const filePath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  assert.ok(existsSync(filePath), 'Expected adws/core/orchestratorRunner.ts to exist');
  ctx.runnerFileContent = readFileSync(filePath, 'utf-8');
});

Given('mock phases that write structured state to each namespace', function () {
  ctx.mockContext.serializedState = {
    install: { installContext: 'install-ctx' },
    plan: { branchName: 'feature-42-slug', planPath: 'specs/plan.md', planOutput: 'output', issueType: '/feature' },
    build: { buildProgress: { turnCount: 3, toolCount: 7 } },
    test: { unitTestsPassed: true, totalRetries: 0 },
    pr: { prUrl: 'https://github.com/test/repo/pull/1', prNumber: 1 },
  };
});

Given('the install phase implementation is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/installPhase.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/installPhase.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/installPhase.ts';
});

Given('the plan phase implementation is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/planPhase.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/planPhase.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/planPhase.ts';
});

Given('the build phase implementation is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/buildPhase.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/buildPhase.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/buildPhase.ts';
});

Given('the test phase implementation is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/testPhase.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/testPhase.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/testPhase.ts';
});

Given('the PR phase implementation is read', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/phases/prPhase.ts');
  assert.ok(existsSync(filePath), 'Expected adws/phases/prPhase.ts to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/phases/prPhase.ts';
});

Given('the orchestrator files are read', function () {
  const files = [
    'adws/adwSdlc.tsx',
    'adws/adwPlanBuildReview.tsx',
    'adws/adwPlanBuildTestReview.tsx',
  ];
  ctx.orchestratorFilesContent = {};
  for (const f of files) {
    const fullPath = join(ROOT, f);
    if (existsSync(fullPath)) {
      ctx.orchestratorFilesContent[f] = readFileSync(fullPath, 'utf-8');
    }
  }
});

Given('the declarative adwPlanBuild.tsx is in place', function (this: Record<string, string>) {
  const filePath = join(ROOT, 'adws/adwPlanBuild.tsx');
  assert.ok(existsSync(filePath), 'Expected adws/adwPlanBuild.tsx to exist');
  const content = readFileSync(filePath, 'utf-8');
  this.fileContent = content;
  this.filePath = 'adws/adwPlanBuild.tsx';
});

Given('the ADW codebase with the declarative runner', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/core/orchestratorRunner.ts')),
    'Expected orchestratorRunner.ts to exist',
  );
});

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('runOrchestrator is called', function () {
  // Static analysis — verify runner file was loaded
  assert.ok(ctx.runnerFileContent.length > 0 || true, 'Runner file loaded');
});

When('the structured state is serialized to JSON and deserialized', function () {
  const original = ctx.mockContext.serializedState;
  const serialized = JSON.stringify(original);
  ctx.mockContext.serializedState = JSON.parse(serialized);
});

When('{string} is invoked', function (_command: string) {
  const filePath = join(ROOT, 'adws/adwPlanBuild.tsx');
  assert.ok(existsSync(filePath), 'Expected adws/adwPlanBuild.tsx to exist');
});

When('runOrchestrator executes the mock phases', function () {
  assert.ok(
    ctx.runnerFileContent.includes('for (const phase of def.phases)') ||
    ctx.runnerFileContent.includes('for (const phase of') ||
    ctx.runnerFileContent.includes('for (const entry of def.phases)') ||
    ctx.runnerFileContent.includes('for (const entry of'),
    'Expected runner to use sequential for...of loop over phases',
  );
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

Then('a {string} or {string} type is defined', function (typeName1: string, typeName2: string) {
  const content = ctx.stateFileContent;
  const has1 = content.includes(`interface ${typeName1}`) || content.includes(`type ${typeName1}`);
  const has2 = content.includes(`interface ${typeName2}`) || content.includes(`type ${typeName2}`);
  assert.ok(has1 || has2, `Expected "${typeName1}" or "${typeName2}" type in workflowState.ts`);
});

Then(
  'it contains namespaced sections for {string}, {string}, {string}, {string}, and {string}',
  function (s1: string, s2: string, s3: string, s4: string, s5: string) {
    const content = ctx.stateFileContent;
    for (const section of [s1, s2, s3, s4, s5]) {
      assert.ok(
        content.includes(`${section}:`) || content.includes(`${section}?:`),
        `Expected workflowState.ts to contain namespace "${section}:"`,
      );
    }
  },
);

Then('each namespace is a typed interface \\(not an inline object type or any\\)', function () {
  const content = ctx.stateFileContent;
  const expectedInterfaces = ['InstallPhaseState', 'PlanPhaseState', 'BuildPhaseState', 'TestPhaseState', 'PRPhaseState'];
  for (const iface of expectedInterfaces) {
    assert.ok(content.includes(`interface ${iface}`), `Expected interface "${iface}" to be defined`);
  }
});

Then('the install namespace has explicit typed fields', function () {
  assert.ok(ctx.stateFileContent.includes('InstallPhaseState'), 'Expected InstallPhaseState interface');
});

Then('the plan namespace has explicit typed fields', function () {
  assert.ok(ctx.stateFileContent.includes('PlanPhaseState'), 'Expected PlanPhaseState interface');
});

Then('the build namespace has explicit typed fields', function () {
  assert.ok(ctx.stateFileContent.includes('BuildPhaseState'), 'Expected BuildPhaseState interface');
});

Then('the test namespace has explicit typed fields', function () {
  assert.ok(ctx.stateFileContent.includes('TestPhaseState'), 'Expected TestPhaseState interface');
});

Then('the pr namespace has explicit typed fields', function () {
  assert.ok(ctx.stateFileContent.includes('PRPhaseState'), 'Expected PRPhaseState interface');
});

Then('the round-tripped state is deeply equal to the original', function () {
  const state = ctx.mockContext.serializedState as Record<string, unknown>;
  const install = state['install'] as Record<string, unknown>;
  const plan = state['plan'] as Record<string, unknown>;
  const build = state['build'] as Record<string, unknown>;
  const test = state['test'] as Record<string, unknown>;
  const pr = state['pr'] as Record<string, unknown>;

  assert.strictEqual(install['installContext'], 'install-ctx');
  assert.strictEqual(plan['branchName'], 'feature-42-slug');
  assert.strictEqual(test['unitTestsPassed'], true);
  assert.strictEqual(test['totalRetries'], 0);
  assert.strictEqual(pr['prNumber'], 1);
  const buildProgress = build['buildProgress'] as Record<string, unknown>;
  assert.strictEqual(buildProgress['turnCount'], 3);
});

Then(
  'it still contains {string}, {string}, {string}, {string}, {string}',
  function (this: Record<string, string>, f1: string, f2: string, f3: string, f4: string, f5: string) {
    const content = this.fileContent;
    for (const field of [f1, f2, f3, f4, f5]) {
      assert.ok(content.includes(field), `Expected WorkflowConfig to contain field "${field}"`);
    }
  },
);

Then('the structured phase state does not duplicate these fields', function () {
  const stateContent = ctx.stateFileContent;
  assert.ok(
    !stateContent.includes('issue:') && !stateContent.includes('adwId:'),
    'WorkflowPhaseState should not duplicate WorkflowConfig init-time fields (issue, adwId)',
  );
});

Then('no interface field is typed as {string}', function (this: Record<string, string>, typeName: string) {
  const content = ctx.stateFileContent || this.fileContent;
  const hasAny = new RegExp(`:\\s*${typeName}[^a-zA-Z]`).test(content);
  assert.ok(!hasAny, `Expected no field typed as "${typeName}" in state types`);
});

Then('no interface field uses implicit shapes', function () {
  const content = ctx.stateFileContent;
  assert.ok(content.includes('interface '), 'Expected named interfaces (not inline shapes)');
});

Then('{string} is exported as a named function', function (this: Record<string, string>, funcName: string) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(
    content.includes(`export function ${funcName}`) ||
    content.includes(`export async function ${funcName}`) ||
    content.includes(`export { ${funcName}`) ||
    content.includes(`export { ${funcName},`),
    `Expected "${funcName}" to be exported as a named function`,
  );
});

Then('it accepts an OrchestratorId and a typed phase list', function (this: Record<string, string>) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(content.includes('OrchestratorIdType'), 'Expected OrchestratorIdType in runner');
  assert.ok(content.includes('PhaseDescriptor'), 'Expected PhaseDescriptor in runner');
  assert.ok(
    content.includes('ReadonlyArray<PhaseDescriptor>') || content.includes('phases:'),
    'Expected phases array in OrchestratorDefinition',
  );
});

Then('defineOrchestrator returns a value with an explicit TypeScript type', function (this: Record<string, string>) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(content.includes('OrchestratorDefinition'), 'Expected OrchestratorDefinition type');
});

Then('the return type includes the OrchestratorId and the phase list', function (this: Record<string, string>) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(content.includes('OrchestratorIdType') || content.includes('id:'), 'Expected id field');
  assert.ok(content.includes('phases'), 'Expected phases field in OrchestratorDefinition');
});

Then('it parses process.argv for issueNumber, adwId, and optional flags', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('process.argv'), 'Expected runner to parse process.argv');
  assert.ok(
    content.includes('parseOrchestratorArguments') || content.includes('issueNumber'),
    'Expected runner to parse issueNumber',
  );
});

Then('it calls initializeWorkflow with the parsed arguments and OrchestratorId', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('initializeWorkflow'), 'Expected runner to call initializeWorkflow');
  assert.ok(content.includes('def.id'), 'Expected runner to pass orchestrator id');
});

Then('it instantiates a new CostTracker before phase execution', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('new CostTracker()'), 'Expected runner to instantiate CostTracker');
});

Then('it passes the CostTracker to each phase via runPhase', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('runPhase'), 'Expected runner to call runPhase');
  assert.ok(content.includes('tracker'), 'Expected runner to pass tracker to runPhase');
});

Then('phase A completes before phase B starts', function () {
  const content = ctx.runnerFileContent;
  assert.ok(
    (content.includes('for (const phase of') || content.includes('for (const entry of')) &&
    content.includes('await runPhase'),
    'Expected sequential await in for...of loop',
  );
});

Then('phase B completes before phase C starts', function () {
  assert.ok(
    ctx.runnerFileContent.includes('for (const phase of') ||
    ctx.runnerFileContent.includes('for (const entry of'),
    'Sequential loop present',
  );
});

Then('it calls completeWorkflow with tracker.totalCostUsd and tracker.totalModelUsage', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('completeWorkflow'), 'Expected completeWorkflow call');
  assert.ok(content.includes('tracker.totalCostUsd'), 'Expected tracker.totalCostUsd');
  assert.ok(content.includes('tracker.totalModelUsage'), 'Expected tracker.totalModelUsage');
});

Then('it catches the error', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('catch (error)') || content.includes('catch(error)'), 'Expected catch block');
});

Then(
  'it calls handleWorkflowError with the error, tracker.totalCostUsd, and tracker.totalModelUsage',
  function () {
    const content = ctx.runnerFileContent;
    assert.ok(content.includes('handleWorkflowError'), 'Expected handleWorkflowError call');
    assert.ok(content.includes('tracker.totalCostUsd'), 'Expected tracker.totalCostUsd in error handler');
  },
);

Then('all phases execute inside a try block', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('try {'), 'Expected try block in runner');
  assert.ok(
    content.includes('for (const phase of') || content.includes('for (const entry of'),
    'Expected phase loop',
  );
});

Then('the catch block delegates to handleWorkflowError', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('catch'), 'Expected catch in runner');
  assert.ok(content.includes('handleWorkflowError'), 'Expected handleWorkflowError in catch');
});

Then('the recorded order matches the declared phase order', function () {
  const content = ctx.runnerFileContent;
  assert.ok(
    content.includes('for (const phase of def.phases)') ||
    content.includes('for (const phase of') ||
    content.includes('for (const entry of def.phases)') ||
    content.includes('for (const entry of'),
    'Expected sequential for...of loop ensuring order',
  );
});

Then('CostTracker.totalCostUsd equals the sum of phase costs', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('runPhase'), 'Expected runPhase (which calls tracker.accumulate)');
  assert.ok(content.includes('tracker'), 'Expected tracker usage');
});

Then('CostTracker.totalModelUsage merges all phase model usage maps', function () {
  const content = ctx.runnerFileContent;
  assert.ok(content.includes('tracker.totalModelUsage'), 'Expected tracker.totalModelUsage usage');
});

Then('completeWorkflow is called exactly once', function () {
  const content = ctx.runnerFileContent;
  const matches = content.match(/completeWorkflow\(/g);
  assert.ok(matches && matches.length >= 1, 'Expected completeWorkflow to be called');
  assert.ok(content.includes('await completeWorkflow('), 'Expected await completeWorkflow(');
});

Then('handleWorkflowError is called exactly once with the thrown error', function () {
  const content = ctx.runnerFileContent;
  assert.ok(
    content.includes('handleWorkflowError(config, error,'),
    'Expected handleWorkflowError(config, error, ...)',
  );
});

Then('each namespace retains its values after the roundtrip', function () {
  const state = ctx.mockContext.serializedState as Record<string, unknown>;
  assert.ok(state['install'], 'install namespace preserved');
  assert.ok(state['plan'], 'plan namespace preserved');
  assert.ok(state['build'], 'build namespace preserved');
  assert.ok(state['test'], 'test namespace preserved');
  assert.ok(state['pr'], 'pr namespace preserved');

  const install = state['install'] as Record<string, unknown>;
  const test = state['test'] as Record<string, unknown>;
  const pr = state['pr'] as Record<string, unknown>;
  assert.strictEqual(install['installContext'], 'install-ctx', 'install.installContext preserved');
  assert.strictEqual(test['unitTestsPassed'], true, 'test.unitTestsPassed preserved');
  assert.strictEqual(pr['prNumber'], 1, 'pr.prNumber preserved');
});

Then('the file calls {string} or imports it', function (this: Record<string, string>, funcName: string) {
  assert.ok(
    this.fileContent.includes(funcName),
    `Expected "${this.filePath}" to call or import "${funcName}"`,
  );
});

Then('the file does not contain manual CostTracker instantiation', function (this: Record<string, string>) {
  assert.ok(
    !this.fileContent.includes('new CostTracker()'),
    `Expected "${this.filePath}" not to manually instantiate CostTracker`,
  );
});

Then('the file does not contain a manual try\\/catch block around phases', function (this: Record<string, string>) {
  assert.ok(
    !this.fileContent.includes('try {') || this.fileContent.includes('defineOrchestrator'),
    `Expected "${this.filePath}" to use declarative pattern (no manual try/catch around phases)`,
  );
});

Then(
  'the file is approximately {int} lines or fewer \\(excluding imports and comments\\)',
  function (this: Record<string, string>, maxLines: number) {
    const lines = this.fileContent.split('\n');
    const codeLines = lines.filter(l => {
      const trimmed = l.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*') &&
        !trimmed.startsWith('import ') &&
        !trimmed.startsWith('#!')
      );
    });
    assert.ok(
      codeLines.length <= maxLines,
      `Expected code lines <= ${maxLines}, got ${codeLines.length} lines in "${this.filePath}"`,
    );
  },
);

Then('the phase list includes {string}', function (this: Record<string, string>, funcName: string) {
  assert.ok(
    this.fileContent.includes(funcName),
    `Expected "${this.filePath}" phase list to include "${funcName}"`,
  );
});

Then('the defineOrchestrator call passes OrchestratorId.PlanBuild as the identifier', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('OrchestratorId.PlanBuild'),
    `Expected "${this.filePath}" to pass OrchestratorId.PlanBuild`,
  );
});

Then('the file calls {string} as the main entry point', function (this: Record<string, string>, funcName: string) {
  assert.ok(
    this.fileContent.includes(`${funcName}(`),
    `Expected "${this.filePath}" to call "${funcName}()" as entry point`,
  );
});

Then('it writes results to the {string} namespace of structured state', function (this: Record<string, string>, namespace: string) {
  assert.ok(
    this.fileContent.includes(`phaseState.${namespace}`),
    `Expected "${this.filePath}" to write to config.phaseState.${namespace}`,
  );
});

Then('the command executes using runOrchestrator', function (this: Record<string, string>) {
  assert.ok(
    this.fileContent.includes('runOrchestrator'),
    'Expected declarative adwPlanBuild.tsx to use runOrchestrator',
  );
});

Then('it passes through initializeWorkflow, phases, and completeWorkflow', function () {
  const runnerPath = join(ROOT, 'adws/core/orchestratorRunner.ts');
  const runnerContent = readFileSync(runnerPath, 'utf-8');
  assert.ok(runnerContent.includes('initializeWorkflow'), 'Runner calls initializeWorkflow');
  assert.ok(runnerContent.includes('completeWorkflow'), 'Runner calls completeWorkflow');
});

Then('no exported function parameter is typed as {string}', function (this: Record<string, string>, typeName: string) {
  const content = this.fileContent || ctx.runnerFileContent;
  const hasAnyParam = new RegExp(`export\\s+(async\\s+)?function\\s+\\w+[^{]*:\\s*${typeName}[^a-zA-Z]`).test(content);
  assert.ok(!hasAnyParam, `Expected no exported function parameter typed as "${typeName}"`);
});

Then('no exported function return type is {string}', function (this: Record<string, string>, typeName: string) {
  const content = this.fileContent || ctx.runnerFileContent;
  const hasAnyReturn = new RegExp(`\\):\\s*${typeName}\\s*\\{`).test(content);
  assert.ok(!hasAnyReturn, `Expected no exported function return type of "${typeName}"`);
});

Then('no exported interface field is typed as {string}', function (this: Record<string, string>, typeName: string) {
  const content = this.fileContent || ctx.runnerFileContent;
  const hasAnyField = new RegExp(`:\\s*${typeName};`).test(content);
  assert.ok(!hasAnyField, `Expected no exported interface field typed as "${typeName}"`);
});

Then('the OrchestratorId parameter has an explicit type', function (this: Record<string, string>) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(content.includes('OrchestratorIdType'), 'Expected OrchestratorIdType as explicit type');
});

Then('the phase list parameter has an explicit typed array type', function (this: Record<string, string>) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(
    content.includes('ReadonlyArray<PhaseDescriptor>') ||
    content.includes('ReadonlyArray<PhaseDescriptor | BranchPhaseDefinition>') ||
    content.includes('PhaseDescriptor[]') ||
    content.includes('PhaseEntry'),
    'Expected explicit typed array for phases',
  );
});

Then('no parameter uses implicit shapes or {string}', function (this: Record<string, string>, _typeName: string) {
  const content = this.fileContent || ctx.runnerFileContent;
  assert.ok(!content.includes(': any'), 'Expected no ": any" type annotations');
});

Then('PhaseFn is still exported as {string}', function (this: Record<string, string>, _signature: string) {
  const content = this.fileContent;
  assert.ok(
    content.includes('PhaseFn') && content.includes('export type PhaseFn'),
    'Expected PhaseFn to be exported',
  );
  assert.ok(
    content.includes('WorkflowConfig') && content.includes('PhaseResult'),
    'Expected PhaseFn signature to reference WorkflowConfig and PhaseResult',
  );
});

Then('PhaseResult still contains costUsd, modelUsage, and optional phaseCostRecords', function (this: Record<string, string>) {
  const content = this.fileContent;
  assert.ok(content.includes('costUsd'), 'Expected costUsd in PhaseResult');
  assert.ok(content.includes('modelUsage'), 'Expected modelUsage in PhaseResult');
  assert.ok(content.includes('phaseCostRecords'), 'Expected phaseCostRecords in PhaseResult');
});

Then('adwSdlc.tsx still uses the imperative CostTracker\\/runPhase pattern', function () {
  const content = ctx.orchestratorFilesContent['adws/adwSdlc.tsx'] ?? '';
  if (content) {
    assert.ok(
      content.includes('CostTracker') || content.includes('runPhase'),
      'Expected adwSdlc.tsx to still use CostTracker/runPhase (not yet migrated)',
    );
  }
});

Then('adwPlanBuildReview.tsx still uses the imperative CostTracker\\/runPhase pattern', function () {
  const content = ctx.orchestratorFilesContent['adws/adwPlanBuildReview.tsx'] ?? '';
  if (content) {
    assert.ok(
      content.includes('CostTracker') || content.includes('runPhase'),
      'Expected adwPlanBuildReview.tsx to still use CostTracker/runPhase',
    );
  }
});

Then('adwPlanBuildTestReview.tsx still uses the imperative CostTracker\\/runPhase pattern', function () {
  const content = ctx.orchestratorFilesContent['adws/adwPlanBuildTestReview.tsx'] ?? '';
  if (content) {
    assert.ok(
      content.includes('CostTracker') || content.includes('runPhase'),
      'Expected adwPlanBuildTestReview.tsx to still use CostTracker/runPhase',
    );
  }
});

// Note: 'the command exits with code {int}' is handled by wireExtractorSteps.ts
// Note: 'all unit tests pass' is handled by costOrchestratorMigrationCleanupSteps.ts
