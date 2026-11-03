import { FloatingPanel, styleButton, styleInput } from "./panel";
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

/**
 * A TEXT-INPUT sibling of openConfirmDialog, on the same surface and in the
 * same idiom: an `openDialog` at a given z-index, with the message, the field
 * and the button strip inside its body. It is the replacement for a native
 * `prompt()`, which blocks the renderer thread outright -- measured with the
 * tab foregrounded, the call raised inside a handler never returned, every
 * `Runtime.evaluate` timed out at 5 s and `Page.handleJavaScriptDialog`
 * answered `{}`. A page that needs a text answer must not require a dialog
 * handler to keep running.
 *
 * The arrow keys and Enter are exactly what the app's own text dialogs
 * (charterModal, settlementInfoMenu) offer: buttons, a focused field, Escape
 * via panelManager. Nothing here is bespoke.
 */
export interface TextInputDialogOptions {
  title: string;
  /** The question above the field -- what a native prompt() would have asked. */
  message: string;
  /** Pre-filled text, selected on open (a native prompt()'s default value). */
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** See ConfirmDialogOptions.zIndex. */
  zIndex?: number;
  /** The field's text as it stands, on confirm. Never trimmed: pass-through. */
  onConfirm: (value: string) => void;
  /**
   * Dismissed without confirming -- Cancel, the × or Escape. The twin of a
   * native prompt() returning null, and the path a caller must handle
   * separately from "confirmed with an empty value".
   */
  onCancel?: () => void;
}

/** The message paragraph both dialogs in this file open with. */
function messageBlock(text: string): HTMLDivElement {
  const msg = document.createElement("div");
  msg.textContent = text;
  Object.assign(msg.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    opacity: "0.9",
    whiteSpace: "pre-line",
  });
  return msg;
}

/** The right-aligned button strip both dialogs in this file end with. */
function buttonRow(buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "8px",
  });
  for (const button of buttons) row.appendChild(button);
  return row;
}

export function openConfirmDialog(opts: ConfirmDialogOptions): FloatingPanel {
  // A dialog, not a bespoke overlay: openDialog owns the backdrop, the
  // centring, the teardown and (via panelManager) Escape, so this file is only
  // the message and the two buttons. zIndex 120 keeps the prompt under the
  // home overlay (200) and the regular dialogs (300), as before.
  const menu = openDialog(document.body, opts.title, 360, false, true, undefined, { zIndex: opts.zIndex ?? 120 });

  menu.appendContent(messageBlock(opts.message));

  const cancel = document.createElement("button");
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  styleButton(cancel);
  cancel.addEventListener("click", () => menu.close());

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

  menu.appendContent(buttonRow([cancel, confirm]));
  return menu;
}

export function openTextInputDialog(opts: TextInputDialogOptions): FloatingPanel {
  // Cancel and confirm BOTH end in menu.close(), and Escape/× do too, so the
  // dismissal path cannot be told apart from the confirm path by the close
  // itself -- this flag is what keeps onCancel from firing on a confirm.
  let confirmed = false;
  const menu = openDialog(
    document.body,
    opts.title,
    360,
    false,
    true,
    () => {
      if (!confirmed) opts.onCancel?.();
    },
    { zIndex: opts.zIndex ?? 120 },
  );

  menu.appendContent(messageBlock(opts.message));

  const input = document.createElement("input");
  input.type = "text";
  input.value = opts.initialValue ?? "";
  styleInput(input);
  menu.appendContent(input);

  const cancel = document.createElement("button");
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  styleButton(cancel);
  cancel.addEventListener("click", () => menu.close());

  const confirm = document.createElement("button");
  confirm.textContent = opts.confirmLabel ?? "Confirm";
  styleButton(confirm, true);
  confirm.addEventListener("click", () => {
    // Read the field once, before onConfirm can do anything with it, and mark
    // the dismissal as intentional before the close runs the onClose chain.
    confirmed = true;
    const value = input.value;
    opts.onConfirm(value);
    menu.close();
  });

  menu.appendContent(buttonRow([cancel, confirm]));

  // The same open affordance the app's other text dialogs use (charterModal):
  // the field is focused with its pre-filled value selected, so the player can
  // type straight over it.
  input.focus();
  input.select();

  return menu;
}
