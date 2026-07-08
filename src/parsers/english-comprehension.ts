import { SubjectParser } from './types.js';

export const englishComprehensionParser: SubjectParser = {
  key: 'english-comprehension',
  label: 'English Comprehension',
  needsMultimodal: false,
  buildPrompt: (rawText: string) => {
    return `You are extracting comprehension passages and related questions. Return strict JSON with passageId linking sub-questions. Input text:\n\n${rawText}`;
  },
  outputSchema: undefined,
};

export default englishComprehensionParser;
