export { classifyEvidence, classifyEvidenceBatch, processUnclassifiedEvidence } from './pipeline';
export type { Classification, ClassifierResult, ClassifierInput, ClassifierFailure } from './types';
export { BASE_WEIGHTS, EVIDENCE_ROUTING, CLASSIFIER_MODEL } from './constants';
export { getDeterministicVersion, getLlmVersion } from './version';
