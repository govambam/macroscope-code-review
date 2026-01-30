/**
 * Code snippet image generation service.
 * Uses Shiki for syntax highlighting and Puppeteer for rendering.
 */

import fs from "fs";
import path from "path";
import { createHighlighter, type Highlighter } from "shiki";
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
      themes: ["dracula"],
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
 * Load the HTML template for code snippets.
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
 * Generate a syntax-highlighted image of a code snippet.
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
      chromium = await import("@sparticuz/chromium");
    }

    // Get the Shiki highlighter
    const highlighter = await getHighlighter();

    // Normalize and validate language
    const normalizedLang = normalizeLanguage(language);
    const loadedLangs = highlighter.getLoadedLanguages();
    const langToUse = loadedLangs.includes(normalizedLang)
      ? normalizedLang
      : "javascript";

    // Generate syntax-highlighted HTML
    const highlightedHtml = highlighter.codeToHtml(code, {
      lang: langToUse,
      theme: "dracula",
    });

    // Load and populate the HTML template
    // Escape language to prevent XSS from user-controlled input
    // Use callback functions to avoid $ special treatment in replacement strings
    const template = loadTemplate();
    const html = template
      .replace("{{HTML_CONTENT}}", () => highlightedHtml)
      .replace("{{LANGUAGE}}", () => escapeHtml(language.toUpperCase()));

    // Launch Puppeteer with Chromium for serverless
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();

      // Set viewport width (height will be auto based on content)
      await page.setViewport({
        width: 650, // Slightly wider to account for padding
        height: 800,
        deviceScaleFactor: 2, // Retina quality
      });

      // Load the HTML content
      await page.setContent(html, { waitUntil: "networkidle0" });

      // Get the bounding box of the code container
      const containerHandle = await page.$(".code-container");
      if (!containerHandle) {
        throw new Error("Could not find code container element");
      }

      const boundingBox = await containerHandle.boundingBox();
      if (!boundingBox) {
        throw new Error("Could not get bounding box of code container");
      }

      // Take screenshot of just the code container
      const screenshotResult = await page.screenshot({
        type: "png",
        clip: {
          x: boundingBox.x,
          y: boundingBox.y,
          width: Math.min(boundingBox.width, 600),
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
