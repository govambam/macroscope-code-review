export interface AIModel {
  id: string;
  displayName: string;
  description: string;
}

export const AI_MODELS: AIModel[] = [
  {
    id: "claude-sonnet-4-5-20250514",
    displayName: "Claude Sonnet 4.5",
    description: "Fast and efficient, great for most tasks",
  },
  {
    id: "claude-opus-4-5-20250514",
    displayName: "Claude Opus 4.5",
    description: "Most capable, best for complex analysis",
  },
  {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    description: "Previous generation Sonnet",
  },
  {
    id: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    description: "Previous generation Opus",
  },
];

export const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";

export function getModelDisplayName(modelId: string): string {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return model?.displayName || modelId;
}

export function getModelShortName(modelId: string): string {
  if (modelId.includes("opus-4-5")) return "Opus 4.5";
  if (modelId.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (modelId.includes("opus-4")) return "Opus 4";
  if (modelId.includes("sonnet-4")) return "Sonnet 4";
  if (modelId.includes("3-5-sonnet")) return "Sonnet 3.5";
  return modelId.split("-").slice(0, 2).join(" ");
}
