import { SubjectParser } from './types.js';

export const reasoningParser: SubjectParser = {
  key: 'general-intelligence-reasoning',
  label: 'General Intelligence & Reasoning',
  needsMultimodal: true,
  buildPrompt: (context: string) => {
    return `You are extracting General Intelligence & Reasoning questions from the attached exam PDF.
Return ONLY strict, complete, valid JSON matching the exam schema — close every string and object; never truncate.

Rules:
- Where diagrams, figures, or series are present, describe them in the question body and use image placeholders for anything that cannot be expressed as text.
- Wrap any mathematical expression in dollar delimiters ($...$ inline, $$...$$ display).
- Represent tables/matrices as 2D string arrays.
- For each question include: number, body blocks, type, options (a/b/c/d), answer_key, and a step-by-step explanation.

Context (section to focus on and any diagram notes extracted from the page images):
${context}`;
  },
  outputSchema: undefined,
};

export default reasoningParser;
