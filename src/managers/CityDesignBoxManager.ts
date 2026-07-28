export interface CityDesignBoxCallbacks {
  onBuild: () => void;
  onGenerate: () => void;
  onBack: () => void;
}

/**
 * Bottom-left "City Design" panel shown while a city is open: houses the
 * Build, Generate, and Back controls for the settlement build view.
 */
export class CityDesignBoxManager {
  private box: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private buildBtn: HTMLButtonElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;
  private backBtn: HTMLButtonElement | null = null;

  show(callbacks: CityDesignBoxCallbacks): void {
    this.hide();

    this.box = document.createElement("div");
    Object.assign(this.box.style, {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      zIndex: "100",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      padding: "8px 10px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.6)",
      borderRadius: "4px",
      fontFamily: "system-ui, sans-serif",
    });

    const title = document.createElement("div");
    title.textContent = "City Design";
    Object.assign(title.style, {
      color: "#fff",
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.02em",
      marginBottom: "2px",
    });
    this.box.appendChild(title);

    this.body = document.createElement("div");
    Object.assign(this.body.style, {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    });
    this.box.appendChild(this.body);

    this.buildBtn = document.createElement("button");
    this.buildBtn.textContent = "⚒ Build";
    Object.assign(this.buildBtn.style, {
      padding: "4px 12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
    });
    this.buildBtn.addEventListener("click", () => callbacks.onBuild());
    this.body.appendChild(this.buildBtn);

    this.generateBtn = document.createElement("button");
    this.generateBtn.textContent = "Generate";
    Object.assign(this.generateBtn.style, {
      padding: "2px 10px",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(0,0,0,0.4)",
      color: "#999",
      fontSize: "10px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
      opacity: "0.6",
    });
    this.generateBtn.addEventListener("click", () => callbacks.onGenerate());
    this.body.appendChild(this.generateBtn);

    this.backBtn = document.createElement("button");
    this.backBtn.textContent = "← Back";
    Object.assign(this.backBtn.style, {
      padding: "4px 12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "3px",
      fontFamily: "system-ui, sans-serif",
    });
    this.backBtn.addEventListener("click", () => callbacks.onBack());
    this.body.appendChild(this.backBtn);

    document.body.appendChild(this.box);
  }

  setBuildPaletteOpen(isOpen: boolean): void {
    if (!this.buildBtn) return;
    this.buildBtn.textContent = isOpen ? "✖ Close" : "⚒ Build";
    this.buildBtn.style.background = isOpen ? "rgba(120,40,40,0.7)" : "rgba(0,0,0,0.7)";
  }

  hide(): void {
    if (this.box) this.box.remove();
    this.box = null;
    this.body = null;
    this.buildBtn = null;
    this.generateBtn = null;
    this.backBtn = null;
  }

  isOpen(): boolean {
    return this.box !== null;
  }
}
