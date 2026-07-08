import { SubjectParser } from './types.js';

export const generalAwarenessParser: SubjectParser = {
  key: 'general-awareness',
  label: 'General Awareness',
  needsMultimodal: false,
  buildPrompt: (rawText: string) => {
    return `You are extracting general awareness factual questions. Output strict JSON of questions and answers. Input:\n\n${rawText}`;
  },
  outputSchema: undefined,
};

export default generalAwarenessParser;
