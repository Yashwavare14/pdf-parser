import { SubjectParser } from './types.js';

export const generalAwarenessParser: SubjectParser = {
  key: 'general-awareness',
  label: 'General Awareness',
  needsMultimodal: false,
  buildPrompt: (context: string) => {
    return `You are extracting General Awareness / factual questions from the attached exam PDF.
Return ONLY strict, complete, valid JSON matching the exam schema — close every string and object; never truncate.

Rules:
- Wrap any mathematical expression in dollar delimiters ($...$ inline, $$...$$ display) if present.
- Represent tables as 2D string arrays and figures as image placeholders.
- For each question include: number, body blocks, type, options (a/b/c/d), answer_key, and a brief explanation.

Context (section to focus on):
${context}`;
  },
  outputSchema: undefined,
};

export default generalAwarenessParser;
