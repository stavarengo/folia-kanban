import { createContext } from "react";

/** What the panel may ask of the dialog it is drawn in; see `DetailModalHandle` in App. */
export interface DetailDialogControls {
  close(): void;
  pushEscape(handler: () => void): () => void;
}

/** Provided by the dialog, so the panel only has it once it is in one. */
export const DetailDialogContext = createContext<DetailDialogControls | null>(null);
