import { PopupMenu, menuTheme, styleButton } from "./menu";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function openConfirmDialog(opts: ConfirmDialogOptions): PopupMenu {
  const parent = document.body;
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "120",
  });
  parent.appendChild(wrapper);

  const menu = new PopupMenu({
    parent: wrapper,
    title: opts.title,
    width: 360,
    draggable: false,
    closeable: true,
    zIndex: 121,
  });

  menu.addCloseHandler(() => wrapper.remove());

  const initialLeft = (window.innerWidth - 360) / 2;
  const initialTop = Math.max(24, (window.innerHeight - 240) / 2);
  menu.setPosition(initialLeft, initialTop);

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

  void menuTheme;
  return menu;
}
