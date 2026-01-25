import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Schema for individual comment analysis (V2 format)
 */
const analysisCommentSchema = z.object({
  index: z.number(),
  macroscope_comment_text: z.string(),
  file_path: z.string(),
  line_number: z.number().nullable(),
  category: z.enum([
    "bug_critical",
    "bug_high",
    "bug_medium",
    "bug_low",
    "suggestion",
    "style",
    "nitpick",
  ]),
  title: z.string(),
  explanation: z.string(),
  explanation_short: z.string().nullable(),
  impact_scenario: z.string().nullable(),
  code_suggestion: z.string().nullable(),
  is_meaningful_bug: z.boolean(),
  outreach_ready: z.boolean(),
  outreach_skip_reason: z.string().nullable(),
});

/**
 * Schema for analysis summary
 */
const analysisSummarySchema = z.object({
  bugs_by_severity: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  non_bugs: z.object({
    suggestions: z.number(),
    style: z.number(),
    nitpicks: z.number(),
  }),
  recommendation: z.string(),
});

/**
 * Schema for PR Analysis prompt output (V2 format)
 * This is the new format that the code expects
 */
export const prAnalysisSchema = z.object({
  total_comments_processed: z.number(),
  meaningful_bugs_count: z.number(),
  outreach_ready_count: z.number(),
  best_bug_for_outreach_index: z.number().nullable(),
  all_comments: z.array(analysisCommentSchema),
  summary: analysisSummarySchema,
});

/**
 * Schema for Email Generation prompt output
 * Note: The email generation prompt returns plain text, not JSON
 * This schema is for reference only - the prompt outputs formatted email text
 */
export const emailGenerationSchema = z.object({
  // Email generation returns plain text with Attio merge fields
  // This schema documents what the code expects to receive
  email_text: z.string().describe("The generated email with Attio merge fields like { First Name }"),
});

/**
 * Map prompt names to their expected output schemas
 * Handles various naming conventions (kebab-case, snake_case, etc.)
 */
export const promptSchemas: Record<string, z.ZodSchema> = {
  // PR Analysis prompt - expects V2 JSON format
  "pr-analysis": prAnalysisSchema,
  "pr_analysis": prAnalysisSchema,
  "PR Analysis": prAnalysisSchema,

  // Email Generation prompt - outputs plain text
  "email-generation": emailGenerationSchema,
  "email_generation": emailGenerationSchema,
  "Email Generation": emailGenerationSchema,
};

/**
 * Get the expected schema for a prompt type
 * Returns null if no schema is defined
 */
export function getPromptSchema(promptType: string): z.ZodSchema | null {
  // Try exact match first
  if (promptSchemas[promptType]) {
    return promptSchemas[promptType];
  }

  // Try normalized versions
  const normalized = promptType.toLowerCase().replace(/[_\s]/g, "-");
  if (promptSchemas[normalized]) {
    return promptSchemas[normalized];
  }

  return null;
}

/**
 * Get required field names from a Zod schema (top-level only)
 */
export function getRequiredFields(schema: z.ZodSchema): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
}

/**
 * Get nested field paths from a Zod schema
 * Returns paths like "summary.bugs_by_severity.critical"
 */
export function getAllFieldPaths(schema: z.ZodSchema, prefix = ""): string[] {
  const paths: string[] = [];

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(shape)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      paths.push(fullPath);

      // Recursively get nested fields
      let innerSchema: z.ZodTypeAny = value;

      // Unwrap all layers of nullable/optional (handles z.string().nullable().optional() etc.)
      let unwrapped = true;
      while (unwrapped) {
        unwrapped = false;
        if (innerSchema instanceof z.ZodNullable) {
          innerSchema = innerSchema.unwrap() as z.ZodTypeAny;
          unwrapped = true;
        }
        if (innerSchema instanceof z.ZodOptional) {
          innerSchema = innerSchema.unwrap() as z.ZodTypeAny;
          unwrapped = true;
        }
      }

      // Handle arrays - get the element schema (also unwrap element schema)
      if (innerSchema instanceof z.ZodArray) {
        let elementSchema: z.ZodTypeAny = innerSchema.element as z.ZodTypeAny;
        // Unwrap array element schema as well
        let elementUnwrapped = true;
        while (elementUnwrapped) {
          elementUnwrapped = false;
          if (elementSchema instanceof z.ZodNullable) {
            elementSchema = elementSchema.unwrap() as z.ZodTypeAny;
            elementUnwrapped = true;
          }
          if (elementSchema instanceof z.ZodOptional) {
            elementSchema = elementSchema.unwrap() as z.ZodTypeAny;
            elementUnwrapped = true;
          }
        }
        if (elementSchema instanceof z.ZodObject) {
          const nestedPaths = getAllFieldPaths(elementSchema, `${fullPath}[]`);
          paths.push(...nestedPaths);
        }
      }

      // Handle nested objects
      if (innerSchema instanceof z.ZodObject) {
        const nestedPaths = getAllFieldPaths(innerSchema, fullPath);
        paths.push(...nestedPaths);
      }
    }
  }

  return paths;
}

/**
 * Convert a Zod schema to a JSON Schema object
 */
export function schemaToJsonSchema(schema: z.ZodSchema): object {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(schema as any, {
    name: "PromptOutputSchema",
    target: "jsonSchema7",
  });
}

/**
 * Convert a Zod schema to a human-readable JSON description string
 */
export function schemaToDescription(schema: z.ZodSchema): string {
  const jsonSchema = schemaToJsonSchema(schema);
  return JSON.stringify(jsonSchema, null, 2);
}

/**
 * Get a simplified representation of the schema for display
 * Shows field names with their types in a tree structure
 */
export function getSchemaTree(schema: z.ZodSchema, indent = 0): string {
  const lines: string[] = [];
  const spaces = "  ".repeat(indent);

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(shape)) {
      const typeInfo = getTypeDescription(value);

      // Check if it's an object or array that needs expansion
      // Unwrap all layers of nullable/optional
      let innerSchema: z.ZodTypeAny = value;
      let unwrapped = true;
      while (unwrapped) {
        unwrapped = false;
        if (innerSchema instanceof z.ZodNullable) {
          innerSchema = innerSchema.unwrap() as z.ZodTypeAny;
          unwrapped = true;
        }
        if (innerSchema instanceof z.ZodOptional) {
          innerSchema = innerSchema.unwrap() as z.ZodTypeAny;
          unwrapped = true;
        }
      }

      if (innerSchema instanceof z.ZodObject) {
        lines.push(`${spaces}${key}: {`);
        lines.push(getSchemaTree(innerSchema, indent + 1));
        lines.push(`${spaces}}`);
      } else if (innerSchema instanceof z.ZodArray) {
        // Also unwrap array element schema
        let elementSchema: z.ZodTypeAny = innerSchema.element as z.ZodTypeAny;
        let elementUnwrapped = true;
        while (elementUnwrapped) {
          elementUnwrapped = false;
          if (elementSchema instanceof z.ZodNullable) {
            elementSchema = elementSchema.unwrap() as z.ZodTypeAny;
            elementUnwrapped = true;
          }
          if (elementSchema instanceof z.ZodOptional) {
            elementSchema = elementSchema.unwrap() as z.ZodTypeAny;
            elementUnwrapped = true;
          }
        }
        if (elementSchema instanceof z.ZodObject) {
          lines.push(`${spaces}${key}: [`);
          lines.push(`${spaces}  {`);
          lines.push(getSchemaTree(elementSchema, indent + 2));
          lines.push(`${spaces}  }`);
          lines.push(`${spaces}]`);
        } else {
          lines.push(`${spaces}${key}: ${typeInfo}`);
        }
      } else {
        lines.push(`${spaces}${key}: ${typeInfo}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Get a human-readable type description for a Zod type
 */
function getTypeDescription(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodNull) return "null";
  if (schema instanceof z.ZodEnum) return `enum(${(schema.options as string[]).join(" | ")})`;
  if (schema instanceof z.ZodArray) return `${getTypeDescription(schema.element as z.ZodTypeAny)}[]`;
  if (schema instanceof z.ZodObject) return "object";
  if (schema instanceof z.ZodNullable) return `${getTypeDescription(schema.unwrap() as z.ZodTypeAny)} | null`;
  if (schema instanceof z.ZodOptional) return `${getTypeDescription(schema.unwrap() as z.ZodTypeAny)}?`;
  return "unknown";
}

/**
 * Schema validation result type
 */
export interface SchemaValidationResult {
  compatible: boolean;
  extracted_fields?: string[];
  missing_fields?: string[];
  type_mismatches?: Array<{ field: string; expected: string; found: string }>;
  renamed_fields?: Array<{ expected: string; found: string; confidence: string }>;
  warnings?: string[];
  summary?: string;
  error?: string;
}

/**
 * Information about a prompt's expected schema
 */
export interface PromptSchemaInfo {
  type: string;
  hasSchema: boolean;
  requiredFields: string[];
  allFieldPaths: string[];
  schemaTree: string;
  fullSchema: string;
}

/**
 * Get complete schema information for a prompt type
 */
export function getPromptSchemaInfo(promptType: string): PromptSchemaInfo {
  const schema = getPromptSchema(promptType);

  if (!schema) {
    return {
      type: promptType,
      hasSchema: false,
      requiredFields: [],
      allFieldPaths: [],
      schemaTree: "",
      fullSchema: "",
    };
  }

  return {
    type: promptType,
    hasSchema: true,
    requiredFields: getRequiredFields(schema),
    allFieldPaths: getAllFieldPaths(schema),
    schemaTree: getSchemaTree(schema),
    fullSchema: schemaToDescription(schema),
  };
}
