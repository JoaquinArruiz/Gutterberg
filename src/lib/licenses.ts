import { invoke } from "@tauri-apps/api/core";

/** Gutterberg's own license and the notices of the software it ships with, both built into the app. */
export type LicenseTexts = { app: string; third_party: string };

export const licenseTexts = () => invoke<LicenseTexts>("license_texts");
