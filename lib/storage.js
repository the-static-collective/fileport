// STATIC FILEPORT storage adapters.
// Neon Object Storage is the canonical/default backend; R2 is optional.
// Every file's storage_provider field selects its provider at read time.
// Neither adapter exposes the upstream object URL to the visitor.

import {
  S3Client, PutObjectCommand, GetObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command
} from "@aws-sdk/client-s3";

export const PRIMARY_PROVIDER = "neon";
export const DEFAULT_NEON_ENDPOINT = "https://br-billowing-rain-bcf3ywwi.storage.c-16.us-east-1.aws.neon.tech";
export const DEFAULT_NEON_BUCKET = "static-fileport-private";
export const STORAGE_PROVIDERS = Object.freeze(["neon", "r2"]);

export class StorageConfigurationError extends Error {
  constructor(message = "Storage provider not configured") {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

function safeEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function neonConfig(env) {
  const endpoint = safeEndpoint(env?.NEON_S3_ENDPOINT || DEFAULT_NEON_ENDPOINT);
  const bucket = env?.NEON_S3_BUCKET || DEFAULT_NEON_BUCKET;
  const region = env?.NEON_S3_REGION || "us-east-1";
  if (!endpoint || !/^[a-z0-9][a-z0-9.-]{1,253}$/.test(bucket) ||
      !/^[a-z0-9-]{3,30}$/.test(region) ||
      typeof env?.NEON_S3_ACCESS_KEY_ID !== "string" ||
      !env.NEON_S3_ACCESS_KEY_ID.startsWith("nak_live_") ||
      typeof env?.NEON_S3_SECRET_ACCESS_KEY !== "string" ||
      !env.NEON_S3_SECRET_ACCESS_KEY.startsWith("nsk_live_")) {
    throw new StorageConfigurationError("Neon object storage credentials or endpoint missing");
  }
  return { endpoint, bucket, region };
}
export function storageConfigured(env) {
  try { neonConfig(env); return true; }
  catch { return false; }
}
export function writeProvider(env) {
  const provider = env?.FILEPORT_WRITE_PROVIDER || PRIMARY_PROVIDER;
  if (!STORAGE_PROVIDERS.includes(provider)) throw new StorageConfigurationError("Unknown storage provider");
  if (provider === "r2" && !env?.FILEPORT_BUCKET) throw new StorageConfigurationError("R2 binding missing");
  if (provider === "neon") neonConfig(env);
  return provider;
}
export function providerForFile(file) {
  const provider = file?.storage_provider;
  if (!STORAGE_PROVIDERS.includes(provider)) throw new StorageConfigurationError("Unknown file storage provider");
  return provider;
}

function neonClient(env) {
  const { endpoint, region } = neonConfig(env);
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true, // Required by Neon for custom S3 endpoints.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.NEON_S3_ACCESS_KEY_ID,
      secretAccessKey: env.NEON_S3_SECRET_ACCESS_KEY
    }
  });
}
function bucketName(env) { return neonConfig(env).bucket; }

export async function storageProbe(env, provider = PRIMARY_PROVIDER) {
  if (provider === "neon") {
    await neonClient(env).send(new ListObjectsV2Command({
      Bucket: bucketName(env), Prefix: "workspaces/", MaxKeys: 1
    }));
    return { provider: "neon", reachable: true };
  }
  if (provider === "r2" && env.FILEPORT_BUCKET) {
    await env.FILEPORT_BUCKET.list({ prefix: "workspaces/", limit: 1 });
    return { provider: "r2", reachable: true };
  }
  throw new StorageConfigurationError();
}

export async function storagePut(env, provider, key, bytes, mimeType) {
  if (provider === "neon") {
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await neonClient(env).send(new PutObjectCommand({
      Bucket: bucketName(env), Key: key, Body: content, ContentType: mimeType
    }));
    return;
  }
  if (provider === "r2" && env.FILEPORT_BUCKET) {
    await env.FILEPORT_BUCKET.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    return;
  }
  throw new StorageConfigurationError();
}

export async function storageGet(env, provider, key, range, expectedSize) {
  if (provider === "neon") {
    let response;
    try {
      response = await neonClient(env).send(new GetObjectCommand({
        Bucket: bucketName(env),
        Key: key,
        ...(range ? { Range: "bytes=" + range.start + "-" + range.end } : {})
      }));
    } catch (e) {
      if (e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
    const status = response.$metadata?.httpStatusCode;
    if (range && (status !== 206 ||
        response.ContentRange !== "bytes " + range.start + "-" + range.end + "/" + range.total)) {
      throw new Error("Storage provider did not honor requested byte range");
    }
    if (!range && status !== 200) throw new Error("Unexpected object storage response");
    const stream = response.Body?.getReader
      ? response.Body
      : response.Body?.transformToWebStream?.();
    if (!stream) throw new Error("Object storage did not supply a web stream");
    const length = Number(response.ContentLength);
    if (!Number.isSafeInteger(length) || length !== (range ? range.length : expectedSize)) {
      throw new Error("Object size mismatch");
    }
    return { body: stream, size: length, etag: response.ETag || null };
  }
  if (provider === "r2" && env.FILEPORT_BUCKET) {
    const object = await env.FILEPORT_BUCKET.get(key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined);
    if (!object) return null;
    if (range && (object.range?.offset !== range.offset || object.range?.length !== range.length)) {
      throw new Error("R2 did not honor requested byte range");
    }
    if (!object.body) throw new Error("R2 did not supply an object stream");
    if (!range && Number(object.size) !== expectedSize) throw new Error("R2 object size mismatch");
    return {
      body: object.body,
      size: range ? range.length : Number(object.size),
      etag: object.httpEtag || null
    };
  }
  throw new StorageConfigurationError();
}

export async function storageDelete(env, provider, key) {
  if (provider === "neon") {
    await neonClient(env).send(new DeleteObjectCommand({ Bucket: bucketName(env), Key: key }));
    return;
  }
  if (provider === "r2" && env.FILEPORT_BUCKET) {
    await env.FILEPORT_BUCKET.delete(key);
    return;
  }
  throw new StorageConfigurationError();
}
