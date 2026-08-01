import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { pushToast } from "./stores/toasts";

/// Checks GitHub releases for a newer signed build and, if found, downloads
/// and installs it before relaunching. Silent when there is nothing to do —
/// a missing update is not news, but a found, installed, or failed one is.
export async function checkForUpdates(): Promise<void> {
  let update;
  try {
    update = await check();
  } catch (e) {
    // Offline, no network, or the endpoint is unreachable. Not worth
    // interrupting the user's session over — log it and move on.
    console.error("Update check failed:", e);
    return;
  }

  if (!update) return;

  pushToast("info", `Updating to ${update.version}…`, "Downloading in the background.");

  try {
    await update.downloadAndInstall();
    pushToast("success", `Updated to ${update.version}`, "Restarting to apply it.");
    await relaunch();
  } catch (e) {
    console.error("Update install failed:", e);
    pushToast(
      "error",
      "Update failed to install",
      e instanceof Error ? e.message : String(e)
    );
  }
}
