import { SubjectParser } from './types.js';

export const quantitativeAptitudeParser: SubjectParser = {
  key: 'quantitative-aptitude',
  label: 'Quantitative Aptitude',
  needsMultimodal: true,
  buildPrompt: (rawText: string) => {
    return `You are extracting quantitative aptitude questions. Return strict JSON matching the exam schema. Include diagrams as LaTeX or image placeholders when present. Input text:\n\n${rawText}`;
  },
  outputSchema: undefined,
};

export default quantitativeAptitudeParser;
