import { SubjectParser } from './types.js';

export const englishComprehensionParser: SubjectParser = {
  key: 'english-comprehension',
  label: 'English Comprehension',
  needsMultimodal: false,
  buildPrompt: (context: string) => {
    return `You are extracting English Comprehension passages and their related questions from the attached exam PDF.
Return ONLY strict, complete, valid JSON matching the exam schema — close every string and object; never truncate.

Rules:
- Group questions that share a reading passage into a single cluster: set has_shared_context to true and place the passage text in shared_context_blocks.
- Wrap any mathematical expression in dollar delimiters ($...$ inline, $$...$$ display) if present.
- For each question include: number, body blocks, type, options (a/b/c/d), answer_key, and a brief explanation.

Context (section to focus on):
${context}`;
  },
  outputSchema: undefined,
};

export default englishComprehensionParser;
