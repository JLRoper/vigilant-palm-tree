export interface AssetSummary {
  key: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  updated_at: string;
}

export async function fetchAssetList(): Promise<AssetSummary[]> {
  const res = await fetch("/api/assets");
  if (!res.ok) throw new Error(`fetchAssetList: ${res.status}`);
  return res.json();
}

export async function fetchAssetBlob(key: string): Promise<Blob> {
  const res = await fetch(`/api/assets/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`fetchAssetBlob(${key}): ${res.status}`);
  return res.blob();
}

export function assetUrl(key: string): string {
  return `/api/assets/${encodeURIComponent(key)}`;
}

export async function uploadAsset(key: string, blob: Blob): Promise<AssetSummary> {
  const res = await fetch(`/api/assets/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type || "image/png" },
  });
  if (!res.ok) throw new Error(`uploadAsset(${key}): ${res.status}`);
  return res.json();
}

export async function deleteAsset(key: string): Promise<void> {
  const res = await fetch(`/api/assets/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`deleteAsset(${key}): ${res.status}`);
}

export async function batchUpload(files: Array<{ key: string; mime_type?: string; data_base64: string }>): Promise<AssetSummary[]> {
  const res = await fetch("/api/assets/batch-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(`batchUpload: ${res.status}`);
  return res.json();
}
