import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_PROVIDER, DEFAULT_NEON_ENDPOINT, DEFAULT_NEON_BUCKET,
  StorageConfigurationError, neonConfig, storageConfigured, writeProvider,
  providerForFile, storageProbe, storagePut, storageGet, storageDelete
} from "../lib/storage.js";

const creds = {
  NEON_S3_ACCESS_KEY_ID: "nak_live_test_key",
  NEON_S3_SECRET_ACCESS_KEY: "nsk_live_test_secret"
};

test("Neon Object Storage is the only required provider and primary upload target", () => {
  assert.equal(PRIMARY_PROVIDER, "neon");
  assert.equal(storageConfigured(creds), true);
  assert.equal(writeProvider(creds), "neon");
  assert.equal(neonConfig(creds).bucket, DEFAULT_NEON_BUCKET);
  assert.equal(neonConfig(creds).endpoint, DEFAULT_NEON_ENDPOINT);
  assert.equal(neonConfig(creds).region, "us-east-1");
  assert.equal(storageConfigured({}), false);
  assert.throws(() => neonConfig({ ...creds, NEON_S3_SECRET_ACCESS_KEY: "wrong" }), StorageConfigurationError);
  assert.throws(() => neonConfig({ ...creds, NEON_S3_ENDPOINT: "http://unsafe.test" }), StorageConfigurationError);
});

test("R2 is optional, selected only explicitly and never inferred for existing files", () => {
  assert.equal(writeProvider({ ...creds, FILEPORT_BUCKET: {} }), "neon");
  assert.throws(() => writeProvider({ ...creds, FILEPORT_WRITE_PROVIDER: "r2" }), StorageConfigurationError);
  assert.equal(writeProvider({ ...creds, FILEPORT_WRITE_PROVIDER: "r2", FILEPORT_BUCKET: {} }), "r2");
  assert.throws(() => writeProvider({ ...creds, FILEPORT_WRITE_PROVIDER: "mystery" }), StorageConfigurationError);
  assert.equal(providerForFile({ storage_provider: "neon" }), "neon");
  assert.equal(providerForFile({ storage_provider: "r2" }), "r2");
  assert.throws(() => providerForFile({ storage_provider: "s3" }), StorageConfigurationError);
  assert.throws(() => providerForFile({}), StorageConfigurationError);
});

test("R2 adapter remains usable for future backend selection and full/range reads", async () => {
  const objects = new Map();
  const operations = [];
  const bucket = {
    async put(key, body, options) {
      objects.set(key, new Uint8Array(body).slice());
      operations.push({ action: "put", key, type: options.httpMetadata.contentType });
    },
    async get(key, options) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      const range = options?.range;
      const data = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      return {
        body: new Response(data).body,
        size: bytes.byteLength,
        ...(range ? { range: { ...range } } : {}),
        httpEtag: '"fake-etag"'
      };
    },
    async delete(key) { objects.delete(key); },
    async list() { return { objects: [...objects.keys()] }; }
  };
  const env = { ...creds, FILEPORT_BUCKET: bucket };
  const key = "workspaces/test/example.mp4";
  const bytes = new TextEncoder().encode("0123456789");
  await storagePut(env, "r2", key, bytes, "video/mp4");
  assert.deepEqual(operations[0], { action: "put", key, type: "video/mp4" });
  assert.deepEqual(await storageProbe(env,"r2"), { provider: "r2", reachable: true });
  const full = await storageGet(env, "r2", key, null, bytes.byteLength);
  assert.equal(full.size, 10);
  assert.equal(await new Response(full.body).text(), "0123456789");
  const range = { offset: 4, length: 3, start: 4, end: 6, total: 10 };
  const part = await storageGet(env, "r2", key, range, 10);
  assert.equal(part.size, 3);
  assert.equal(part.etag, '"fake-etag"');
  assert.equal(await new Response(part.body).text(), "456");
  await storageDelete(env, "r2", key);
  assert.equal(await storageGet(env, "r2", key, null, 10), null);
});

test("R2 cannot silently serve the wrong byte range", async () => {
  const env = {
    ...creds,
    FILEPORT_BUCKET: {
      get: async () => ({ body: new Response("wrong").body, size: 10 })
    }
  };
  await assert.rejects(
    () => storageGet(env, "r2", "test", { offset: 1, length: 2, start: 1, end: 2, total: 10 }, 10),
    /did not honor requested byte range/
  );
});

test("no implicit downgrade to R2 if Neon credentials are missing", async () => {
  assert.equal(storageConfigured({ FILEPORT_BUCKET: {} }), false);
  await assert.rejects(() => storagePut({ FILEPORT_BUCKET: {} }, "neon", "a", new Uint8Array([1]), "text/plain"), StorageConfigurationError);
  await assert.rejects(() => storageGet({}, "unrecognized", "a", null, 1), StorageConfigurationError);
});
