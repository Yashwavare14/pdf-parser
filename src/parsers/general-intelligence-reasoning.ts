import { SubjectParser } from './types.js';

export const reasoningParser: SubjectParser = {
  key: 'general-intelligence-reasoning',
  label: 'General Intelligence & Reasoning',
  needsMultimodal: true,
  buildPrompt: (rawText: string) => {
    return `Extract reasoning and pattern-based questions. Where diagrams or series are present, include patternType and image placeholders. Return strict JSON. Input:\n\n${rawText}`;
  },
  outputSchema: undefined,
};

export default reasoningParser;
