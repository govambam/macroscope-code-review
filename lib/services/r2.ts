/**
 * Cloudflare R2 storage service for uploading images.
 * R2 is S3-compatible, so we use the AWS SDK.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

interface UploadImageOptions {
  buffer: Buffer;
  filename: string; // e.g., "snippets/pr42-abc123.png"
  contentType: string;
}

/**
 * Get the S3 client configured for R2.
 * Returns null if R2 is not configured.
 */
function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Upload an image to Cloudflare R2.
 *
 * @param options - Upload options including buffer, filename, and content type
 * @returns The public URL of the uploaded image
 * @throws Error if R2 is not configured or upload fails
 */
export async function uploadToR2(options: UploadImageOptions): Promise<string> {
  const { buffer, filename, contentType } = options;

  const client = getR2Client();
  if (!client) {
    throw new Error(
      "R2 is not configured. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY environment variables."
    );
  }

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME environment variable is not set.");
  }

  const publicDomain = process.env.R2_PUBLIC_DOMAIN;
  if (!publicDomain) {
    throw new Error(
      "R2_PUBLIC_DOMAIN environment variable is not set. This should be your R2 public bucket URL or custom domain."
    );
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable", // Cache for 1 year
  });

  await client.send(command);

  // Construct the public URL
  // Remove trailing slash from domain if present
  const domain = publicDomain.replace(/\/$/, "");
  return `${domain}/${filename}`;
}

/**
 * Check if R2 is configured and available.
 */
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_DOMAIN
  );
}
