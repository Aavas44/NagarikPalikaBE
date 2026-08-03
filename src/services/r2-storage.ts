import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET_NAME?.trim()
  );
}

export function getR2BucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }
  return bucket;
}

export function getR2Client(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : undefined);

  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME."
    );
  }

  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  return client;
}

/** Best-effort bucket check. Account tokens often lack Admin — create the bucket in the Cloudflare dashboard if PutObject fails. */
export async function ensureR2Bucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const s3 = getR2Client();
      const bucket = getR2BucketName();
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch {
        // fall through to create attempt
      }
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err) {
        console.warn(
          `[R2] Bucket "${bucket}" could not be verified/created (${
            err instanceof Error ? err.message : String(err)
          }). Create it in Cloudflare R2 if uploads fail.`
        );
      }
    })().catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  await bucketReady;
}

export async function putR2Object(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await ensureR2Bucket();
  const s3 = getR2Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

export async function getR2Object(key: string): Promise<Buffer> {
  await ensureR2Bucket();
  const s3 = getR2Client();
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    })
  );
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error("File not found in storage");
  }
  return Buffer.from(bytes);
}

export async function deleteR2Object(key: string): Promise<void> {
  await ensureR2Bucket();
  const s3 = getR2Client();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    })
  );
}
