import { useState } from "react";

/**
 * An add-something box that empties as it sends: a failed write hands the text back, into an
 * empty box only, and only while the panel is still there to show it.
 */
export function useInlineDraft(stillHere: () => boolean) {
  const [value, setValue] = useState("");
  const send = (text: string, write: () => Promise<boolean>) => {
    setValue("");
    void write().then((ok) => {
      if (!ok && stillHere()) setValue((cur) => cur || text);
    });
  };
  return { value, setValue, send };
}

export type InlineDraft = ReturnType<typeof useInlineDraft>;
