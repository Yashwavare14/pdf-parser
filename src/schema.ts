import { z } from 'zod';

// 1. Definition of distinct individual block fragments
export const ContentBlockSchema = z.object({
  type: z.enum(['text', 'latex', 'table', 'image_placeholder']),
  text_content: z.string().describe('The clean text string, raw LaTeX markup string, or markdown layout layout syntax.'),
  table_data: z.array(z.array(z.string()))
    .optional()
    .describe("A multidimensional 2D array matrix tracking rows and columns if type is set to 'table'."),
  image_reference_tag: z.string()
    .optional()
    .describe("A short human-readable label for the figure if type is 'image_placeholder', e.g. 'figure for Q5' or 'option (a) figure'."),
  image_page: z.number()
    .optional()
    .describe("For 'image_placeholder' only: the 1-based PDF page number on which the figure appears."),
  image_bbox: z.array(z.number())
    .optional()
    .describe("For 'image_placeholder' only: the figure's bounding box as [ymin, xmin, ymax, xmax], each an integer 0-1000 normalized to the page (0,0 = top-left, 1000,1000 = bottom-right), tightly enclosing the figure.")
});

// 2. Question blueprint structure tracing parameters
export const QuestionItemSchema = z.object({
  question_number: z.string().describe("The sequence tag number identifier tracking the item index, e.g. 'Q1' or 'Q77'"),
  question_body: z.array(ContentBlockSchema).describe('An ordered collection array of content blocks building the complete body text.'),
  question_type: z.enum(['multiple_choice', 'multiple_response', 'numerical_fill_in', 'true_false']),
  options: z.array(z.object({
    key: z.enum(['a', 'b', 'c', 'd', 'e']),
    content: z.array(ContentBlockSchema).describe('The structural array blocks making up individual choices (can contain equations).')
  })).optional().describe('Array of options. Provide only if question_type is an objective layout type; leave empty/null on open fill-ins.'),
  answer_key: z.string().describe('The exact target character code or strict numeric answer value matched from the solutions block index.'),
  explanation: z.array(ContentBlockSchema).describe('Step-by-step mathematical reasoning or calculations mapped directly from solution indices.')
});

// 3. Root document collection metadata layout wrapped for API transport
export const UniversalExamSchema = z.object({
  paper_title: z.string().describe('The overarching descriptive header title extracted from the exam paper context metadata.'),
  question_clusters: z.array(z.object({
    has_shared_context: z.boolean().describe('True if multiple nested questions depend on a mutual reading passage block, layout chart, or data matrix.'),
    shared_context_blocks: z.array(ContentBlockSchema)
      .optional()
      .describe('Shared common context text passages, graphics anchors, or tables that govern child question indices directly.'),
    sub_questions: z.array(QuestionItemSchema).describe('The functional questions housed safely within the context of this cluster element boundary block.')
  })).describe('Collection arrays of question clusters mapped out of the target file layout structures.')
});

export type UniversalExam = z.infer<typeof UniversalExamSchema>;
