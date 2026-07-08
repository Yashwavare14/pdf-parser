import { quantitativeAptitudeParser } from './quantitative-aptitude.js';
import { englishComprehensionParser } from './english-comprehension.js';
import { generalAwarenessParser } from './general-awareness.js';
import { reasoningParser } from './general-intelligence-reasoning.js';
import type { SubjectParser } from './types.js';

const registry: Record<string, SubjectParser> = {
  [quantitativeAptitudeParser.key]: quantitativeAptitudeParser,
  [englishComprehensionParser.key]: englishComprehensionParser,
  [generalAwarenessParser.key]: generalAwarenessParser,
  [reasoningParser.key]: reasoningParser,
};

export function getSubjectParser(key: string): SubjectParser {
  const parser = registry[key];
  if (!parser) throw new Error(`Unknown subject: ${key}`);
  return parser;
}

export function listSubjects() {
  return Object.values(registry).map(({ key, label }) => ({ key, label }));
}

export function detectSectionKey(headingText: string): string | null {
  const normalized = String(headingText || '').toLowerCase().trim();
  if (normalized.includes('quantitative')) return 'quantitative-aptitude';
  if (normalized.includes('reasoning') || normalized.includes('intelligence')) return 'general-intelligence-reasoning';
  if (normalized.includes('english')) return 'english-comprehension';
  if (normalized.includes('general awareness') || normalized.includes('general awareness')) return 'general-awareness';
  return null;
}
