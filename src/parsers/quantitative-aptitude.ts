import { SubjectParser } from './types.js';

export const quantitativeAptitudeParser: SubjectParser = {
  key: 'quantitative-aptitude',
  label: 'Quantitative Aptitude',
  needsMultimodal: true,
  buildPrompt: (context: string) => {
    return `You are extracting Quantitative Aptitude questions from the attached exam PDF.
Return ONLY strict, complete, valid JSON matching the exam schema — close every string and object; never truncate.

Rules:
- Wrap every mathematical expression in dollar delimiters: $...$ for inline math and $$...$$ for display math.
- Represent tables as 2D string arrays and figures/diagrams as image placeholders.
- For each question include: number, body blocks, type, options (a/b/c/d), answer_key, and a step-by-step explanation.

Context (section to focus on and any diagram notes extracted from the page images):
${context}`;
  },
  outputSchema: undefined,
};

export default quantitativeAptitudeParser;
