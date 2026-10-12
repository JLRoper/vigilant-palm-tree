// Single Profile surface (user-profile scheme, .plans/20261012-0145):
// one component reused by the home-screen "Profile" button and the settings
// menu's "Profile" section. Server-authoritative: the panel fetches GET
// /auth/me on open and PATCHes on save -- no local store, no second cache.
// Escape = discard-and-close; Save is the only mutation path.
import { openCenteredModal, styleButton, styleInput, menuTheme } from "@screens/shared/menu";
import { getMe, logout, updateMe } from "../../io/auth";
import type { UserProfile } from "../../io/authTypes";

export interface ProfilePanelOptions {
  /** Cached session bearer token (must exist -- anonymous callers never open this panel). */
  token: string;
  /** Current email, shown read-only while the profile loads. */
  email: string;
  /** Invoked after a successful sign-out so the host can refresh its auth UI. */
  onSignedOut: () => void;
}

function formatLastPlayed(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function openProfilePanel(opts: ProfilePanelOptions): void {
  const modal = openCenteredModal(document.body, "Profile", 380, false, true, undefined, {
    escape: true,
  });
  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "8px";

  const status = document.createElement("div");
  Object.assign(status.style, { ...menuTheme.error, minHeight: "16px" });
  status.style.color = "rgba(201,162,39,1)";
  status.textContent = "Loading profile…";
  content.appendChild(status);

  // Account name (the only editable field -- email changes need
  // re-verification and are deliberately out of scope pre-alpha0).
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Account name";
  nameLabel.style.opacity = "0.7";
  content.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 64;
  nameInput.placeholder = "Loading…";
  nameInput.disabled = true;
  styleInput(nameInput);
  content.appendChild(nameInput);

  // Email: identity, read-only.
  const emailLabel = document.createElement("label");
  emailLabel.textContent = "Email (read-only)";
  emailLabel.style.opacity = "0.7";
  content.appendChild(emailLabel);
  const emailRow = document.createElement("div");
  emailRow.textContent = opts.email;
  emailRow.style.opacity = "0.85";
  content.appendChild(emailRow);

  // Stats: games started / last played. games_won shows "N/A" -- no win
  // condition exists yet, so the counter is always 0 and must not mislead.
  const statsBox = document.createElement("div");
  Object.assign(statsBox.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px",
    background: "#0e0e0e",
    borderRadius: "4px",
    border: "1px solid rgba(255,255,255,0.08)",
  });
  const gamesRow = document.createElement("div");
  const wonRow = document.createElement("div");
  const playedRow = document.createElement("div");
  for (const row of [gamesRow, wonRow, playedRow]) {
    row.style.fontSize = "12px";
    statsBox.appendChild(row);
  }
  gamesRow.textContent = "Games started: …";
  wonRow.textContent = "Games won: N/A (no win condition yet)";
  playedRow.textContent = "Last played: …";
  content.appendChild(statsBox);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    marginTop: "10px",
  });

  const signOutBtn = document.createElement("button");
  signOutBtn.textContent = "Sign out";
  styleButton(signOutBtn);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  row.appendChild(signOutBtn);
  row.appendChild(spacer);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Close";
  styleButton(cancelBtn);
  cancelBtn.addEventListener("click", () => modal.close());
  row.appendChild(cancelBtn);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  styleButton(saveBtn, true);
  saveBtn.disabled = true;
  row.appendChild(saveBtn);
  content.appendChild(row);

  let profile: UserProfile | null = null;

  function renderLoaded(loaded: UserProfile): void {
    profile = loaded;
    nameInput.value = loaded.account_name;
    nameInput.disabled = false;
    nameInput.placeholder = "";
    emailRow.textContent = loaded.email;
    gamesRow.textContent = `Games started: ${loaded.games_started}`;
    playedRow.textContent = `Last played: ${formatLastPlayed(loaded.last_played_at)}`;
    saveBtn.disabled = true;
    status.textContent = "";
  }

  function setBusy(value: boolean): void {
    saveBtn.disabled = value || !profile;
    signOutBtn.disabled = value;
    cancelBtn.disabled = value;
    nameInput.disabled = value;
    for (const b of [saveBtn, signOutBtn, cancelBtn]) {
      b.style.opacity = value ? "0.6" : "1";
    }
  }

  nameInput.addEventListener("input", () => {
    if (!profile) return;
    saveBtn.disabled = nameInput.value.trim() === profile.account_name || nameInput.value.trim() === "";
  });

  saveBtn.addEventListener("click", async () => {
    if (!profile) return;
    const nextName = nameInput.value.trim();
    if (!nextName || nextName === profile.account_name) return;
    setBusy(true);
    status.style.color = "rgba(201,162,39,1)";
    status.textContent = "Saving…";
    try {
      const updated = await updateMe(opts.token, nextName);
      renderLoaded(updated);
      status.textContent = "Saved.";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.style.color = menuTheme.error.color;
      status.textContent = msg.includes("409") ? "That account name is taken." : `Save failed: ${msg}`;
      setBusy(false);
    }
  });

  signOutBtn.addEventListener("click", async () => {
    setBusy(true);
    try {
      await logout(opts.token);
      modal.close();
      opts.onSignedOut();
    } catch {
      setBusy(false);
    }
  });

  void getMe(opts.token)
    .then(renderLoaded)
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      status.style.color = menuTheme.error.color;
      status.textContent = msg.includes("unauthorized")
        ? "Session expired. Sign in again."
        : `Failed to load profile: ${msg}`;
    });

  modal.setContent(content);
  nameInput.focus();
}
