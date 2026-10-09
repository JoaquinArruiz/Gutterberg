import { useTranslation } from "react-i18next";
import logoLight from "../../../assets/brand/logo.svg";
import logoDark from "../../../assets/brand/logo-dark.svg";
import { useAppName } from "../../lib/app-info";

/** The logo for the theme in effect (the app's setting, not only the system's; see `.logo-for-*` in index.css). */
export function BrandLogo({ className }: { className?: string }) {
  const { t } = useTranslation();
  const name = useAppName();
  const alt = name ? t("brand.logoAlt", { name }) : t("brand.logoAltPlain");
  return (
    <>
      <img src={logoLight} alt={alt} className={`logo-for-light ${className ?? ""}`} draggable={false} />
      <img src={logoDark} alt={alt} className={`logo-for-dark ${className ?? ""}`} draggable={false} />
    </>
  );
}
