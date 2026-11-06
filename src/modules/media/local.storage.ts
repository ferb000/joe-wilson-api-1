import { promises as fs, createReadStream, createWriteStream } from "fs";
import { resolve, sep, dirname, join } from "path";
import { createHash, randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { env } from "../../config/env";
import { HttpError } from "../../utils/httpError";

export const localStorageEnabled =
  env.STORAGE_DRIVER === "local" && env.NODE_ENV === "development";
export const localStorageRoot = resolve(env.LOCAL_STORAGE_DIRECTORY);
function missing(): never {
  throw Object.assign(new HttpError(404, "File not found"), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
  });
}
export function localObjectPath(key: string) {
  if (
    !key ||
    key.length > 1024 ||
    key
      .split("/")
      .some(
        (part) =>
          !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..",
      )
  )
    throw new HttpError(400, "Invalid file key");
  const root = resolve(localStorageRoot, "objects");
  const target = resolve(root, ...key.split("/"));
  if (!target.startsWith(root + sep))
    throw new HttpError(400, "Invalid file key");
  return target;
}
function metadataPath(key: string) {
  localObjectPath(key);
  return join(
    localStorageRoot,
    "metadata",
    createHash("sha256").update(key).digest("hex") + ".json",
  );
}
async function atomicJson(file: string, value: unknown) {
  await fs.mkdir(dirname(file), { recursive: true });
  const temp = file + "." + randomUUID();
  await fs.writeFile(temp, JSON.stringify(value));
  await fs.rename(temp, file);
}
export async function headLocalObject(key: string) {
  try {
    const stat = await fs.stat(localObjectPath(key));
    const meta = JSON.parse(await fs.readFile(metadataPath(key), "utf8"));
    if (!stat.isFile()) return missing();
    return { ContentLength: stat.size, ContentType: meta.contentType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing();
    throw error;
  }
}
function uploadDirectory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "Invalid upload");
  return join(localStorageRoot, "uploads", id);
}
async function uploadInfo(id: string, key: string) {
  try {
    const info = JSON.parse(
      await fs.readFile(join(uploadDirectory(id), "upload.json"), "utf8"),
    );
    if (info.key !== key) throw new HttpError(403, "Upload mismatch");
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing();
    throw error;
  }
}
export async function writeLocalPart(
  id: string,
  key: string,
  part: number,
  body: Buffer,
) {
  await uploadInfo(id, key);
  if (!Number.isInteger(part) || part < 1 || part > 10000)
    throw new HttpError(400, "Invalid upload part");
  const file = join(uploadDirectory(id), String(part));
  const temporary = file + "." + randomUUID();
  await fs.writeFile(temporary, body);
  await fs.rename(temporary, file);
  return createHash("sha256").update(body).digest("hex");
}
async function removeUpload(id: string) {
  const directory = uploadDirectory(id);
  try {
    for (const name of await fs.readdir(directory))
      await fs.unlink(join(directory, name));
    await fs.rmdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function put(
  key: string,
  body: any,
  contentType: string,
  signal?: AbortSignal,
) {
  const target = localObjectPath(key);
  await fs.mkdir(dirname(target), { recursive: true });
  const temporary = target + "." + randomUUID();
  try {
    if (
      Buffer.isBuffer(body) ||
      typeof body === "string" ||
      body instanceof Uint8Array
    )
      await fs.writeFile(temporary, body, { signal });
    else
      await pipeline(body, createWriteStream(temporary, { flags: "wx" }), {
        signal,
      });
    await fs.rename(temporary, target);
    await atomicJson(metadataPath(key), { contentType });
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function removeObject(key: string) {
  await fs.unlink(localObjectPath(key)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await fs.unlink(metadataPath(key)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
// Implements the object commands used by uploads and the FFmpeg worker, without a network service.
export const localObjectClient = {
  async send(
    command: any,
    options?: { abortSignal?: AbortSignal },
  ): Promise<any> {
    if (!localStorageEnabled)
      throw new HttpError(
        503,
        "Local storage is available only in development",
      );
    const input = command.input;
    const key = input.Key;
    options?.abortSignal?.throwIfAborted();
    switch (command.constructor.name) {
      case "PutObjectCommand":
        await put(
          key,
          input.Body,
          input.ContentType || "application/octet-stream",
          options?.abortSignal,
        );
        return {};
      case "HeadObjectCommand":
        return headLocalObject(key);
      case "GetObjectCommand":
        return {
          ...(await headLocalObject(key)),
          Body: createReadStream(localObjectPath(key)),
        };
      case "DeleteObjectCommand":
        await removeObject(key);
        return {};
      case "CreateMultipartUploadCommand": {
        localObjectPath(key);
        const id = randomUUID();
        await atomicJson(join(uploadDirectory(id), "upload.json"), {
          key,
          contentType: input.ContentType,
        });
        return { UploadId: id };
      }
      case "AbortMultipartUploadCommand":
        await removeUpload(input.UploadId);
        return {};
      case "ListPartsCommand": {
        await uploadInfo(input.UploadId, key);
        const directory = uploadDirectory(input.UploadId);
        const names = (await fs.readdir(directory))
          .filter((name) => /^\d+$/.test(name))
          .sort((a, b) => Number(a) - Number(b));
        const parts = [];
        for (const name of names) {
          const body = await fs.readFile(join(directory, name));
          parts.push({
            PartNumber: Number(name),
            Size: body.length,
            ETag: createHash("sha256").update(body).digest("hex"),
          });
        }
        return { Parts: parts, IsTruncated: false };
      }
      case "CompleteMultipartUploadCommand": {
        const info = await uploadInfo(input.UploadId, key);
        const directory = uploadDirectory(input.UploadId);
        async function* chunks() {
          for (const part of input.MultipartUpload.Parts) {
            if (
              !Number.isInteger(part.PartNumber) ||
              part.PartNumber < 1 ||
              part.PartNumber > 10000
            )
              throw new HttpError(400, "Invalid upload part");
            const bytes = await fs.readFile(
              join(directory, String(part.PartNumber)),
            );
            if (createHash("sha256").update(bytes).digest("hex") !== part.ETag)
              throw new HttpError(409, "Upload part changed; retry completion");
            yield bytes;
          }
        }
        const { Readable } = await import("stream");
        await put(
          key,
          Readable.from(chunks()),
          info.contentType,
          options?.abortSignal,
        );
        await removeUpload(input.UploadId);
        return {};
      }
      case "ListObjectsV2Command": {
        const prefix: string = input.Prefix;
        localObjectPath(prefix.replace(/\/$/, ""));
        const keys: string[] = [];
        async function scan(directory: string, relative: string) {
          let entries;
          try {
            entries = await fs.readdir(directory, { withFileTypes: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
          }
          for (const entry of entries) {
            if (keys.length >= (input.MaxKeys || 1000)) break;
            const name = relative + entry.name;
            if (entry.isDirectory())
              await scan(join(directory, entry.name), name + "/");
            else if (entry.isFile() && name.startsWith(prefix)) keys.push(name);
          }
        }
        await scan(localObjectPath(prefix.replace(/\/$/, "")), prefix);
        return { Contents: keys.map((Key) => ({ Key })) };
      }
      case "DeleteObjectsCommand":
        for (const object of input.Delete.Objects)
          await removeObject(object.Key);
        return { Errors: [] };
      default:
        throw new Error("Unsupported local storage operation");
    }
  },
};
