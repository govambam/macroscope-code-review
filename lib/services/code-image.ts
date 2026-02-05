/**
 * Code snippet image generation service.
 * Uses Shiki for syntax highlighting and Puppeteer for rendering.
 * Supports both plain code snippets and diff-style views.
 */

import fs from "fs";
import path from "path";
import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";
import { uploadToR2, isR2Configured } from "./r2";

// Lazy-loaded modules for serverless environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromium: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharp: any = null;

interface GenerateCodeImageOptions {
  code: string;
  language: string;
  prId: string; // for unique naming
}

interface GenerateCodeImageResult {
  url: string;
  success: boolean;
  error?: string;
}

interface DiffLine {
  type: "removed" | "added" | "context";
  code: string;
}

// Singleton highlighter promise (store promise to prevent race condition)
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get or create the Shiki highlighter instance.
 * Stores the promise (not the resolved value) to prevent duplicate initialization
 * when concurrent calls occur before the first initialization completes.
 * Clears the cached promise on rejection to allow retries.
 */
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["dracula", "github-light"],
      langs: [
        "javascript",
        "typescript",
        "python",
        "java",
        "go",
        "rust",
        "c",
        "cpp",
        "csharp",
        "ruby",
        "php",
        "swift",
        "kotlin",
        "scala",
        "html",
        "css",
        "json",
        "yaml",
        "markdown",
        "sql",
        "shell",
        "bash",
        "dockerfile",
      ],
    }).catch((error) => {
      // Clear the cached promise on rejection to allow retries
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Map common file extensions and language names to Shiki language IDs.
 */
function normalizeLanguage(language: string): string {
  const langMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    cs: "csharp",
    "c++": "cpp",
    sh: "shell",
    yml: "yaml",
    md: "markdown",
    jsx: "javascript",
    tsx: "typescript",
  };

  const normalized = language.toLowerCase().trim();
  return langMap[normalized] || normalized;
}

/**
 * Load the HTML template for plain code snippets.
 */
function loadTemplate(): string {
  const templatePath = path.join(
    process.cwd(),
    "lib",
    "templates",
    "code-snippet.html"
  );
  return fs.readFileSync(templatePath, "utf-8");
}

/**
 * Load the HTML template for diff views.
 */
function loadDiffTemplate(): string {
  const templatePath = path.join(
    process.cwd(),
    "lib",
    "templates",
    "code-diff.html"
  );
  return fs.readFileSync(templatePath, "utf-8");
}

/**
 * Parse code suggestion text into diff lines.
 * Returns null if the text doesn't contain diff markers.
 */
function parseDiffLines(code: string): DiffLine[] | null {
  const lines = code.split("\n");
  let hasRemovals = false;
  let hasAdditions = false;
  const diffLines: DiffLine[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Hunk header — treat as context
      diffLines.push({ type: "context", code: line });
    } else if (line.startsWith("-")) {
      diffLines.push({ type: "removed", code: line.slice(1) });
      hasRemovals = true;
    } else if (line.startsWith("+")) {
      diffLines.push({ type: "added", code: line.slice(1) });
      hasAdditions = true;
    } else {
      diffLines.push({ type: "context", code: line });
    }
  }

  // Require both + and - markers to avoid false positives from
  // plain code that happens to start a line with + or -
  return (hasRemovals && hasAdditions) ? diffLines : null;
}

/**
 * Build diff HTML with syntax-highlighted lines and colored backgrounds.
 * Uses Shiki's codeToTokens for per-token highlighting, then wraps
 * each line in the appropriate diff row styling.
 */
async function buildDiffHtml(
  diffLines: DiffLine[],
  language: BundledLanguage,
  highlighter: Highlighter
): Promise<string> {
  // Separate removed and added lines for independent highlighting
  const removedLines = diffLines.filter((l) => l.type === "removed");
  const addedLines = diffLines.filter((l) => l.type === "added");
  const contextLines = diffLines.filter((l) => l.type === "context");

  // Highlight each group separately
  const highlightGroup = (lines: DiffLine[]) => {
    if (lines.length === 0) return [];
    const code = lines.map((l) => l.code).join("\n");
    const result = highlighter.codeToTokens(code, {
      lang: language,
      theme: "github-light",
    });
    return result.tokens;
  };

  const removedTokenLines = highlightGroup(removedLines);
  const addedTokenLines = highlightGroup(addedLines);
  const contextTokenLines = highlightGroup(contextLines);

  // Track consumption index for each group
  let removedIdx = 0;
  let addedIdx = 0;
  let contextIdx = 0;

  // Build table rows
  const rows: string[] = [];
  for (const diffLine of diffLines) {
    let tokenLine;
    let gutterSymbol: string;
    let lineClass: string;

    if (diffLine.type === "removed") {
      tokenLine = removedTokenLines[removedIdx++];
      gutterSymbol = "\u2212"; // minus sign
      lineClass = "removed";
    } else if (diffLine.type === "added") {
      tokenLine = addedTokenLines[addedIdx++];
      gutterSymbol = "+";
      lineClass = "added";
    } else {
      tokenLine = contextTokenLines[contextIdx++];
      gutterSymbol = "";
      lineClass = "context";
    }

    // Render tokens to HTML spans
    const codeHtml = tokenLine
      ? tokenLine
          .map((token) => {
            const style = token.color ? ` style="color:${token.color}"` : "";
            return `<span${style}>${escapeHtml(token.content)}</span>`;
          })
          .join("")
      : escapeHtml(diffLine.code);

    rows.push(
      `<tr class="diff-line ${lineClass}">` +
        `<td class="diff-gutter">${gutterSymbol}</td>` +
        `<td class="diff-code">${codeHtml}</td>` +
        `</tr>`
    );
  }

  return rows.join("\n");
}

/**
 * Generate a syntax-highlighted image of a code snippet.
 * Automatically detects diff-formatted code and renders as a
 * GitHub-style diff view with red/green backgrounds.
 *
 * @param options - Code, language, and PR ID for naming
 * @returns Object with success status and URL (if successful)
 */
export async function generateCodeImage(
  options: GenerateCodeImageOptions
): Promise<GenerateCodeImageResult> {
  const { code, language, prId } = options;

  // Check if R2 is configured
  if (!isR2Configured()) {
    return {
      url: "",
      success: false,
      error: "R2 storage is not configured",
    };
  }

  try {
    // Lazy load dependencies
    if (!puppeteer) {
      puppeteer = await import("puppeteer-core");
    }
    if (!chromium) {
      chromium = (await import("@sparticuz/chromium")).default;
    }

    // Get the Shiki highlighter
    const highlighter = await getHighlighter();

    // Normalize and validate language
    const normalizedLang = normalizeLanguage(language);
    const loadedLangs = highlighter.getLoadedLanguages();
    const langToUse = (loadedLangs.includes(normalizedLang)
      ? normalizedLang
      : "javascript") as BundledLanguage;

    // Detect if code is in diff format and choose rendering path
    const diffLines = parseDiffLines(code);
    let html: string;
    let containerSelector: string;

    if (diffLines) {
      // Diff rendering path
      const diffRowsHtml = await buildDiffHtml(diffLines, langToUse, highlighter);
      const template = loadDiffTemplate();
      html = template
        .replace("{{DIFF_ROWS}}", () => diffRowsHtml)
        .replace("{{LANGUAGE}}", () => escapeHtml(language.toUpperCase()));
      containerSelector = ".diff-container";
    } else {
      // Plain code rendering path (fallback)
      const highlightedHtml = highlighter.codeToHtml(code, {
        lang: langToUse,
        theme: "dracula",
      });
      const template = loadTemplate();
      html = template
        .replace("{{HTML_CONTENT}}", () => highlightedHtml)
        .replace("{{LANGUAGE}}", () => escapeHtml(language.toUpperCase()));
      containerSelector = ".code-container";
    }

    // Launch Puppeteer with Chromium for serverless
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();

      await page.setViewport({
        width: 500,  // Slightly larger than container (450px) to allow for padding
        height: 800,
        deviceScaleFactor: 2,
      });

      // Load the HTML content
      await page.setContent(html, { waitUntil: "networkidle0" });

      // Get the bounding box of the container
      const containerHandle = await page.$(containerSelector);
      if (!containerHandle) {
        throw new Error(`Could not find ${containerSelector} element`);
      }

      const boundingBox = await containerHandle.boundingBox();
      if (!boundingBox) {
        throw new Error("Could not get bounding box of container");
      }

      // Take screenshot of just the container
      // Container has fixed width of 450px for consistent image sizing
      const screenshotResult = await page.screenshot({
        type: "png",
        clip: {
          x: boundingBox.x,
          y: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
        omitBackground: true,
      });

      // Ensure we have a Buffer
      let screenshotBuffer: Buffer = Buffer.isBuffer(screenshotResult)
        ? screenshotResult
        : Buffer.from(screenshotResult);

      // Optimize with sharp if the image is too large
      if (screenshotBuffer.length > 100 * 1024) {
        try {
          if (!sharp) {
            sharp = (await import("sharp")).default;
          }
          screenshotBuffer = await sharp(screenshotBuffer)
            .png({ quality: 80, compressionLevel: 9 })
            .toBuffer();
        } catch (sharpError) {
          console.warn("Sharp optimization failed, using original:", sharpError);
          // Continue with original buffer
        }
      }

      // Generate unique filename
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `snippets/pr${prId}-${timestamp}-${randomSuffix}.png`;

      // Upload to R2
      const url = await uploadToR2({
        buffer: screenshotBuffer,
        filename,
        contentType: "image/png",
      });

      return {
        url,
        success: true,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Code image generation failed:", errorMessage);

    return {
      url: "",
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if code image generation is available.
 * Returns true if all required dependencies and configuration are present.
 */
export function isCodeImageGenerationAvailable(): boolean {
  return isR2Configured();
}
