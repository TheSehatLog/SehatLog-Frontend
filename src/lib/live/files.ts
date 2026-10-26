// Encrypted file attachments (crypto spec section 7). Each file has its own key, which
// travels only inside the encrypted entry that references it.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, toHex, type Attachment } from "./api.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

type Raw = (path: string, init?: RequestInit) => Promise<Response>;

async function errorOf(res: Response) {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(data?.error ?? `Request failed (${res.status})`);
}

/** Encrypts a file in the browser and uploads the ciphertext. */
export async function uploadEncrypted(raw: Raw, recordId: string, category: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<Attachment> {
  if (file.bytes.length > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25 MB`);
  const fileId = "fil_" + toHex(sc.randomBytes(8));
  const key = sc.randomBytes(32);
  const sealed = await sc.sealFile(key, sc.randomBytes(12), file.bytes as Uint8Array<ArrayBuffer>, recordId, fileId, category);
  const res = await raw(`/v1/records/${recordId}/files/${fileId}?category=${encodeURIComponent(category)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: sealed,
  });
  if (!res.ok) throw await errorOf(res);
  return { file_id: fileId, name: file.name, mime: file.type || "application/octet-stream", size: file.bytes.length, key: toB64(key) };
}

/** Downloads and decrypts an attachment; returns its plaintext bytes. */
export async function fetchDecrypted(raw: Raw, recordId: string, category: string, a: Attachment): Promise<Uint8Array> {
  const res = await raw(`/v1/files/${a.file_id}`);
  if (!res.ok) throw await errorOf(res);
  const blob = new Uint8Array(await res.arrayBuffer());
  return sc.openFile(fromB64(a.key), blob, recordId, a.file_id, category);
}

/** Browser only: decrypt and save the attachment. */
export async function saveAttachment(raw: Raw, recordId: string, category: string, a: Attachment) {
  const bytes = await fetchDecrypted(raw, recordId, category, a);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: a.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = a.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
