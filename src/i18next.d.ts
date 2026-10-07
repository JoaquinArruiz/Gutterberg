import type en from "./locales/en.json";

// Typed keys: `t("toolbar.openPdff")` is a type error.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
