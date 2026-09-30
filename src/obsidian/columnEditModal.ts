// The "Edit column" dialog (#8): every editable column field as a `Setting` row in the app's own
// `Modal`. Only the colour row is drawn here, because Folia offers a fixed palette rather than a
// free colour picker.

import { Modal, Setting, type App, type TextComponent } from "obsidian";
import { columnDraft, columnPatch, type ColumnDraft, type ColumnPatch } from "../model/columns";
import type { ColumnDef, ColumnGroup, ColumnSort } from "../model/types";
import { columnAccent, columnColorName, COLUMN_COLORS } from "../ui/columnColors";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Name a row's control by the row's own label: an `aria-label` would show as a tooltip. */
function labelBy(setting: Setting, control: HTMLElement): void {
  setting.nameEl.id ||= `folia-col-edit-${Math.random().toString(36).slice(2)}`;
  control.setAttr("aria-labelledby", setting.nameEl.id);
}

class ColumnEditModal extends Modal {
  private draft: ColumnDraft;
  private title!: TextComponent;

  constructor(
    app: App,
    column: ColumnDef,
    private onSave: (patch: ColumnPatch) => void,
  ) {
    super(app);
    this.draft = columnDraft(column);
    this.setTitle("Edit column");
    this.addTitleRow();
    this.addColorRow();
    this.addRuleRows();
    this.addOpacityRows();
    this.addParkRow();
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => this.save()),
      );
  }

  private addTitleRow(): void {
    const d = this.draft;
    const row = new Setting(this.contentEl).setName("Title");
    row.addText((t) => {
      this.title = t;
      t.setValue(d.title).onChange((v) => (d.title = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.save();
      });
      labelBy(row, t.inputEl);
    });
  }

  private addColorRow(): void {
    const d = this.draft;
    const row = new Setting(this.contentEl).setName("Color");
    // Only the swatch row is Folia's to draw, so only it carries `folia-scope`, where the
    // `--folia-*` tokens hang: on the whole dialog, the board's focus ring and type size would
    // reach Obsidian's own controls.
    const swatches = row.controlEl.createDiv({ cls: "folia-swatches folia-scope" });
    swatches.setAttr("role", "group");
    labelBy(row, swatches);
    const swatch = (label: string, color: string, pressed: boolean) => {
      const b = swatches.createEl("button", {
        cls: "folia-swatch" + (pressed ? " folia-is-active" : ""),
        attr: { type: "button", "aria-label": label, "aria-pressed": String(pressed) },
      });
      b.style.setProperty("--folia-swatch-color", color);
      return b;
    };
    const draw = () => {
      swatches.empty();
      const active = columnColorName(d.color);
      for (const c of COLUMN_COLORS)
        swatch(`Set color ${c}`, columnAccent(c), active === c).addEventListener("click", () => {
          d.color = c;
          draw();
        });
      // A colour the note carries that is not one of the eight: shown, so the column's own colour
      // is visible in the row, and unpickable, since the eight are what a new pick writes.
      if (d.color && !active) swatch(`Custom color ${d.color}`, d.color, true).disabled = true;
      // "No colour" is the choice a column never given a colour is making. The board paints such a
      // column from `autoColor`, a colour nobody picked, so the ring goes where the stored value is.
      const none = swatches.createEl("button", {
        cls: "folia-swatch folia-swatch-none" + (d.color ? "" : " folia-is-active"),
        text: "No color",
        attr: { type: "button", "aria-pressed": String(!d.color) },
      });
      none.addEventListener("click", () => {
        d.color = undefined;
        draw();
      });
    };
    draw();
  }

  /** The WIP limit and the rules deciding which cards the column draws, and in what order. */
  private addRuleRows(): void {
    const d = this.draft;
    const el = this.contentEl;
    const limit = new Setting(el).setName("WIP limit");
    limit.addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.setPlaceholder("None")
        .setValue(d.limit)
        .onChange((v) => (d.limit = v));
      labelBy(limit, t.inputEl);
    });
    const filter = new Setting(el)
      .setName("Filter rule")
      .setDesc("Shows only cards matching this query. Leave blank to show all.");
    filter.addText((t) => {
      t.setPlaceholder("For example area:research status:todo")
        .setValue(d.filter)
        .onChange((v) => (d.filter = v));
      labelBy(filter, t.inputEl);
    });
    const group = new Setting(el).setName("Group by");
    group.addDropdown((dd) => {
      dd.addOption("none", "None")
        .addOption("due", "Due date")
        .setValue(d.group)
        .onChange((v) => (d.group = v as ColumnGroup));
      labelBy(group, dd.selectEl);
    });
    const sort = new Setting(el).setName("Sort by");
    sort.addDropdown((dd) => {
      dd.addOption("manual", "Manual")
        .addOption("priority", "Priority")
        .addOption("due", "Due date")
        .setValue(d.sort)
        .onChange((v) => (d.sort = v as ColumnSort));
      labelBy(sort, dd.selectEl);
    });
  }

  private addOpacityRows(): void {
    const d = this.draft;
    const hoverName = () =>
      `Reveal on hover — ${d.hoverOpacity === undefined ? "full" : pct(d.hoverOpacity)}`;
    const opacity = new Setting(this.contentEl).setName(`Opacity — ${pct(d.opacity)}`);
    const hover = new Setting(this.contentEl).setName(hoverName());
    opacity.addSlider((s) => {
      // Instant, so the percentage in the name and the hover row follow the drag, not the release.
      s.setLimits(0.1, 1, 0.05)
        .setInstant(true)
        .setValue(d.opacity)
        .onChange((v) => {
          d.opacity = v;
          opacity.setName(`Opacity — ${pct(v)}`);
          // Revealing on hover only means something for a column that is faded to begin with.
          hover.settingEl.toggle(v < 1);
        });
      labelBy(opacity, s.sliderEl);
    });
    hover.addSlider((s) => {
      s.setLimits(0, 100, 5)
        .setInstant(true)
        .setValue(d.hoverOpacity === undefined ? 100 : Math.round(d.hoverOpacity * 100))
        .onChange((v) => {
          // Full is what an unset value already means, so dragging back to it unsets it rather than
          // writing a `hoverOpacity: 1` the note never had.
          d.hoverOpacity = v === 100 ? undefined : v / 100;
          hover.setName(hoverName());
        });
      labelBy(hover, s.sliderEl);
    });
    hover.settingEl.toggle(d.opacity < 1);
  }

  private addParkRow(): void {
    const row = new Setting(this.contentEl)
      .setName("Park aside")
      .setDesc("Move this column off to the far right (de-emphasise a rabbit-hole column).");
    row.addToggle((t) => {
      t.setValue(this.draft.parked).onChange((v) => (this.draft.parked = v));
      labelBy(row, t.toggleEl);
    });
  }

  override onOpen(): void {
    this.title.inputEl.focus();
    this.title.inputEl.select();
  }

  private save(): void {
    const patch = columnPatch(this.draft);
    // A blank title is refused, and the dialog stays open on it so it can be fixed.
    if (!patch) {
      this.title.inputEl.focus();
      return;
    }
    this.onSave(patch);
    this.close();
  }
}

export function openColumnEditor(
  app: App,
  column: ColumnDef,
  onSave: (patch: ColumnPatch) => void,
): void {
  new ColumnEditModal(app, column, onSave).open();
}
