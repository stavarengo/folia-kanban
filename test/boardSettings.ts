import { DEFAULT_DEVICE_STATE } from "../src/deviceState";
import { DEFAULT_SETTINGS, type BoardSettings } from "../src/settings";

/** What a board runs on when nothing was set and this device remembers nothing yet. */
export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  ...DEFAULT_SETTINGS,
  ...DEFAULT_DEVICE_STATE,
};
