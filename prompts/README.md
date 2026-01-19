# AI Prompts

This directory contains prompt templates for AI-powered features in the Macroscope PR Creator tool.

## Structure

Each prompt file follows this format:
- **Header**: Model name and purpose
- **Body**: The actual prompt with variable placeholders
- **Variables section**: Documents what variables can be interpolated

## Available Prompts

### pr-analysis.md
- **Model**: Claude Opus 4.5 (`claude-opus-4-5-20250514`)
- **Purpose**: Analyze PRs to identify meaningful bugs found by Macroscope
- **Variables**:
  - `{FORKED_PR_URL}` - The forked PR URL containing Macroscope's review comments
  - `{ORIGINAL_PR_URL}` - The original PR URL for additional context
- **Output**: JSON with bug analysis results

## Adding New Prompts

1. Create a new `.md` file in this directory
2. Follow the existing format with header, body, and variables section
3. Use `{VARIABLE_NAME}` syntax for placeholders
4. Document the prompt in this README
5. Use the prompt loader utility to load and interpolate:

```typescript
import { loadPrompt } from '@/lib/services/prompt-loader';

const prompt = loadPrompt('your-prompt-name', {
  VARIABLE_NAME: 'value'
});
```

## Best Practices

- Keep prompts focused on a single task
- Document expected output format clearly
- Include examples where helpful
- Use clear variable names
- Test prompts thoroughly before deploying
