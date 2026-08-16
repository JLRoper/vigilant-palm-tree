import { openCenteredModal, menuTheme, styleButton } from "@screens/shared/menu";
import {
  fetchAssetList,
  uploadAsset,
  deleteAsset,
  assetUrl,
  type AssetSummary,
} from "../../io/assetApi";

export function openAssetManager(): void {
  const modal = openCenteredModal(document.body, "Asset Manager", 720, false);
  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;

  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.gap = "8px";
  toolbar.style.alignItems = "center";

  const uploadBtn = document.createElement("button");
  uploadBtn.textContent = "Upload PNG";
  styleButton(uploadBtn, true);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png";
  fileInput.style.display = "none";

  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "Refresh";
  styleButton(refreshBtn);

  const statusEl = document.createElement("span");
  statusEl.style.fontSize = "11px";
  statusEl.style.opacity = "0.6";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Filter by key...";
  searchInput.style.cssText = "padding:4px 8px;background:#0e0e0e;color:#eee;border:1px solid rgba(255,255,255,0.2);border-radius:3px;font-size:11px;flex:1";

  toolbar.appendChild(uploadBtn);
  toolbar.appendChild(fileInput);
  toolbar.appendChild(refreshBtn);
  toolbar.appendChild(searchInput);
  toolbar.appendChild(statusEl);
  content.appendChild(toolbar);

  const previewRow = document.createElement("div");
  previewRow.style.display = "flex";
  previewRow.style.gap = "10px";
  previewRow.style.minHeight = "220px";

  const listPanel = document.createElement("div");
  listPanel.style.cssText = "flex:0 0 260px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);border-radius:3px;background:#111;max-height:400px";

  const previewPanel = document.createElement("div");
  previewPanel.style.cssText = "flex:1;border:1px solid rgba(255,255,255,0.1);border-radius:3px;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden;max-height:400px";

  const previewImg = document.createElement("img");
  previewImg.style.cssText = "max-width:100%;max-height:100%;object-fit:contain";
  previewPanel.appendChild(previewImg);

  const infoPanel = document.createElement("div");
  infoPanel.style.cssText = "flex:0 0 200px;font-size:11px;color:#aaa;padding:4px";
  infoPanel.textContent = "Select an asset to preview";

  previewRow.appendChild(listPanel);
  previewRow.appendChild(previewPanel);
  previewRow.appendChild(infoPanel);
  content.appendChild(previewRow);

  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.gap = "8px";

  const downloadBtn = document.createElement("button");
  downloadBtn.textContent = "Download";
  styleButton(downloadBtn);
  downloadBtn.disabled = true;

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.style.cssText = "padding:6px 12px;background:rgba(120,30,30,0.6);color:#eee;border:1px solid rgba(255,100,100,0.3);border-radius:4px;font-size:12px;cursor:pointer";
  deleteBtn.disabled = true;

  actionRow.appendChild(downloadBtn);
  actionRow.appendChild(deleteBtn);
  content.appendChild(actionRow);

  modal.setContent(content);

  let selectedKey: string | null = null;
  let allAssets: AssetSummary[] = [];

  function renderList(filter: string) {
    listPanel.innerHTML = "";
    const filtered = filter
      ? allAssets.filter((a) => a.key.toLowerCase().includes(filter.toLowerCase()))
      : allAssets;

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:20px;text-align:center;color:#666;font-style:italic";
      empty.textContent = "No assets found";
      listPanel.appendChild(empty);
      return;
    }

    for (const asset of filtered) {
      const row = document.createElement("div");
      row.style.cssText = "padding:6px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;display:flex;justify-content:space-between";
      row.style.background = asset.key === selectedKey ? "rgba(247,127,0,0.2)" : "";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = asset.key;
      nameSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1";

      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = formatBytes(asset.byte_size);
      sizeSpan.style.cssText = "opacity:0.5;margin-left:8px;flex-shrink:0";

      row.appendChild(nameSpan);
      row.appendChild(sizeSpan);

      row.addEventListener("click", () => {
        selectedKey = asset.key;
        renderList(searchInput.value);
        selectAsset(asset.key);
      });

      listPanel.appendChild(row);
    }
  }

  function selectAsset(key: string) {
    previewImg.src = assetUrl(key);
    downloadBtn.disabled = false;
    deleteBtn.disabled = false;

    const asset = allAssets.find((a) => a.key === key);
    if (asset) {
      infoPanel.innerHTML = [
        `<strong>${asset.key}</strong>`,
        `Type: ${asset.mime_type}`,
        `Size: ${formatBytes(asset.byte_size)}`,
        `Created: ${new Date(asset.created_at).toLocaleString()}`,
        `Updated: ${new Date(asset.updated_at).toLocaleString()}`,
      ].join("<br>");
    }
  }

  async function refresh() {
    statusEl.textContent = "Loading...";
    try {
      allAssets = await fetchAssetList();
      statusEl.textContent = `${allAssets.length} assets`;
      renderList(searchInput.value);
    } catch (err) {
      statusEl.textContent = "Failed to load";
      console.error(err);
    }
  }

  searchInput.addEventListener("input", () => {
    renderList(searchInput.value);
  });

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const key = prompt("Asset key (e.g. castle.1):", file.name.replace(/\.png$/i, ""));
    if (!key) { fileInput.value = ""; return; }
    statusEl.textContent = "Uploading...";
    try {
      await uploadAsset(key, file);
      fileInput.value = "";
      await refresh();
    } catch (err) {
      statusEl.textContent = "Upload failed";
      console.error(err);
    }
  });

  refreshBtn.addEventListener("click", refresh);

  downloadBtn.addEventListener("click", () => {
    if (!selectedKey) return;
    const a = document.createElement("a");
    a.href = assetUrl(selectedKey);
    a.download = selectedKey.replace(/[^a-zA-Z0-9.-]/g, "_") + ".png";
    a.click();
  });

  deleteBtn.addEventListener("click", async () => {
    if (!selectedKey) return;
    if (!confirm(`Delete "${selectedKey}"?`)) return;
    statusEl.textContent = "Deleting...";
    try {
      await deleteAsset(selectedKey);
      if (selectedKey === selectedKey) {
        selectedKey = null;
        previewImg.src = "";
        downloadBtn.disabled = true;
        deleteBtn.disabled = true;
        infoPanel.textContent = "Select an asset to preview";
      }
      await refresh();
    } catch (err) {
      statusEl.textContent = "Delete failed";
      console.error(err);
    }
  });

  refresh();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
