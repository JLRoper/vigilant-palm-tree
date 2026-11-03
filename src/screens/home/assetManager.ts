import { panelTheme, styleButton } from "@screens/shared/panel";
import { openDialog } from "@screens/shared/dialog";
import { openConfirmDialog, openTextInputDialog } from "@screens/shared/confirmDialog";
import {
  fetchAssetList,
  uploadAsset,
  deleteAsset,
  assetUrl,
  type AssetSummary,
} from "../../io/assetApi";

export function openAssetManager(): void {
  const modal = openDialog(document.body, "Asset Manager", 720, false);
  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";
  content.style.fontFamily = panelTheme.font;
  content.style.fontSize = panelTheme.fontSize;

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

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    // NOT a native prompt(): it blocks the renderer thread outright -- measured
    // in a real browser, tab foregrounded (document.hidden === false), the same
    // way the alert() and confirm() cards measured their sites: the change
    // dispatch never returned (`Runtime.evaluate timed out` at 5 s, because the
    // box opens inside this handler), every `Runtime.evaluate` -- `1+1`,
    // `location.href`, even a counter read -- timed out at 5 s, and
    // `Page.handleJavaScriptDialog` answered `{}` (a dialog really was
    // pending), which unwedged the tab instantly. Across that window the
    // animation loop stood still for 15 555 ms between two frames 12 ms apart.
    // The app's own dialog costs the player nothing.
    //
    // Everything the native call did is kept: the pre-filled value is still the
    // file name minus .png, an empty or cancelled answer still aborts the
    // upload, and the key is never logged. The manager is itself a dialog
    // (300), so the prompt has to clear it.
    openTextInputDialog({
      title: "Asset key",
      message: "Asset key (e.g. castle.1):",
      initialValue: file.name.replace(/\.png$/i, ""),
      confirmLabel: "Upload",
      zIndex: 320,
      onConfirm: (key) => {
        void uploadWithKey(key, file);
      },
      onCancel: () => {
        fileInput.value = "";
      },
    });
  });

  /**
   * The resume path the native prompt() left behind, unchanged: an empty key
   * aborts before anything is touched, otherwise the file goes up under `key`
   * and the list reloads. The key is never logged.
   */
  async function uploadWithKey(key: string, file: File): Promise<void> {
    if (!key) {
      fileInput.value = "";
      return;
    }
    statusEl.textContent = "Uploading...";
    try {
      await uploadAsset(key, file);
      fileInput.value = "";
      await refresh();
    } catch (err) {
      statusEl.textContent = "Upload failed";
      console.error(err);
    }
  }

  refreshBtn.addEventListener("click", refresh);

  downloadBtn.addEventListener("click", () => {
    if (!selectedKey) return;
    const a = document.createElement("a");
    a.href = assetUrl(selectedKey);
    a.download = selectedKey.replace(/[^a-zA-Z0-9.-]/g, "_") + ".png";
    a.click();
  });

  async function performDelete(key: string): Promise<void> {
    statusEl.textContent = "Deleting...";
    try {
      await deleteAsset(key);
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
  }

  deleteBtn.addEventListener("click", () => {
    if (!selectedKey) return;
    const key = selectedKey;
    openConfirmDialog({
      title: "Delete asset",
      message: `Delete "${key}"?`,
      confirmLabel: "Delete",
      destructive: true,
      // The manager is itself a dialog (300); the prompt has to clear it.
      zIndex: 320,
      onConfirm: () => {
        void performDelete(key);
      },
    });
  });

  refresh();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
