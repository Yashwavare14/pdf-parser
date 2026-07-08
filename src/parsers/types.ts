export interface SubjectParser {
  key: string;
  label: string;
  needsMultimodal?: boolean;
  buildPrompt: (rawText: string) => string;
  outputSchema?: any; // optional schema descriptor (zod/json-schema)
}

export type SubjectRegistration = SubjectParser;
