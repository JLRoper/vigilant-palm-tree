import { FloatingPanel, styleButton } from "./panel";
import { openDialog } from "./dialog";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * The dialog wrapper's z-index. The default (120) keeps the prompt under the
   * home overlay (200) and the regular dialogs (300), which is right for a
   * caller raised from the map. A caller raised from a surface that is ITSELF
   * above 120 -- the landing page's Load dialog, the Asset Manager -- must pass
   * a higher one: the prompt is a modal, and a backdrop drawn under the surface
   * that raised it is a prompt the player can see but not click.
   */
  zIndex?: number;
  onConfirm: () => void;
}

export function openConfirmDialog(opts: ConfirmDialogOptions): FloatingPanel {
  // A dialog, not a bespoke overlay: openDialog owns the backdrop, the
  // centring, the teardown and (via panelManager) Escape, so this file is only
  // the message and the two buttons. zIndex 120 keeps the prompt under the
  // home overlay (200) and the regular dialogs (300), as before.
  const menu = openDialog(document.body, opts.title, 360, false, true, undefined, { zIndex: opts.zIndex ?? 120 });

  const msg = document.createElement("div");
  msg.textContent = opts.message;
  Object.assign(msg.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    opacity: "0.9",
    whiteSpace: "pre-line",
  });
  menu.appendContent(msg);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  });

  const cancel = document.createElement("button");
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  styleButton(cancel);
  cancel.addEventListener("click", () => menu.close());
  row.appendChild(cancel);

  const confirm = document.createElement("button");
  confirm.textContent = opts.confirmLabel ?? "Confirm";
  styleButton(confirm, !opts.destructive);
  if (opts.destructive) {
    confirm.style.background = "rgba(120,40,40,0.7)";
  }
  confirm.addEventListener("click", () => {
    opts.onConfirm();
    menu.close();
  });
  row.appendChild(confirm);

  menu.appendContent(row);
  return menu;
}
