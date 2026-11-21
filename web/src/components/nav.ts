import type { IconType } from "react-icons";
import { MdBuild, MdGroup, MdMonitorHeart, MdPalette, MdPerson, MdQueryStats, MdSmartphone, MdWebhook } from "react-icons/md";

export interface Tab {
  href: string;
  label: string;
  short: string;
  icon: IconType;
  admin?: boolean;
  /** Shown in the mobile bottom bar. */
  mobile?: boolean;
  /** Lives in the user menu instead of the top bar. */
  menu?: boolean;
}

/** The navigation tabs, in order. */
export const TABS: Tab[] = [
  { href: "/", label: "Device", short: "Device", icon: MdSmartphone, mobile: true },
  { href: "/pages", label: "Pages", short: "Pages", icon: MdPalette, mobile: true },
  { href: "/tools", label: "Tools", short: "Tools", icon: MdBuild, mobile: true },
  { href: "/webhooks", label: "Webhooks", short: "Webhooks", icon: MdWebhook, admin: true, mobile: true },
  { href: "/events", label: "Event Logs", short: "Events", icon: MdQueryStats, mobile: true },
  { href: "/diagnostics", label: "Diagnostics", short: "Diagnostics", icon: MdMonitorHeart, admin: true },
  { href: "/users", label: "Users", short: "Users", icon: MdGroup, admin: true, menu: true },
  { href: "/account", label: "Account", short: "Account", icon: MdPerson, menu: true },
];

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
