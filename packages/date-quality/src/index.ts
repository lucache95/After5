// @after5/date-quality — offline date-quality eval foundation.
// Pure, offline, zero network. Grades the generator writing-pass output.

export type {
  PlaceFacts,
  FixtureInputs,
  FixtureStop,
  Fixture,
  WrittenStop,
  WrittenDate,
  WriteResult,
  GateSeverity,
  GateResult,
  JudgeScores,
  JudgeWeights,
} from './types';
export { SEVERITY_CAP, WEIGHTS } from './types';

export { computeScore, finalScore } from './score';

export type {
  InvokeLLM,
  RunWritingPassOptions,
} from './writingPass';
export {
  runWritingPass,
  buildUserMessage,
  parseLLMResponse,
  buildFallbackWhatToDo,
} from './writingPass';

export type {
  JudgeEvidence,
  JudgeResult,
  JudgeOptions,
} from './judge';
export {
  judge,
  buildJudgeUserMessage,
  parseJudgeResponse,
  SYSTEM_PROMPT as JUDGE_SYSTEM_PROMPT,
  JUDGE_CITY,
} from './judge';

export type {
  FixtureResult,
  EvalReport,
  Regression,
  ComparisonResult,
  RunEvalOptions,
} from './runEval';
export {
  runEval,
  gradeFixture,
  loadFixtures,
  compareToBaseline,
  renderJson,
  renderMarkdown,
  buildDryWritten,
  dryGenerateLLM,
  dryJudgeLLM,
  MEAN_DROP_THRESHOLD,
  FIXTURE_DROP_THRESHOLD,
} from './runEval';

export type { Gate } from './gates';
export {
  GATES,
  runGates,
  titleLength,
  titleNoTimeOfDay,
  noBannedWords,
  noEmoji,
  hookLength,
  whyItWorksSentences,
  whatToDoQuality,
  placeNameGrounding,
  unsupportedConcreteClaim,
  categoryVariety,
  adjacentStopContrast,
  exactlyOnePeak,
  budgetRealism,
  userIntentCompliance,
  openAtArrival,
  timeOfDayOrder,
  travelPacing,
  scheduleMonotonic,
  firstDateSafety,
  portfolioDiversity,
} from './gates';
