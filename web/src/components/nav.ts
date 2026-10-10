export interface Tab {
  href: string;
  label: string;
  short: string;
  icon: string;
  admin?: boolean;
  /** Shown in the mobile bottom bar. */
  mobile?: boolean;
}

/** Same tabs, order and icons as the original UI. */
export const TABS: Tab[] = [
  { href: "/", label: "Device", short: "Device", icon: "📱", mobile: true },
  { href: "/pages", label: "Pages", short: "Pages", icon: "🎨", mobile: true },
  { href: "/tools", label: "Tools", short: "Tools", icon: "🧰", mobile: true },
  { href: "/webhooks", label: "Webhooks", short: "Webhooks", icon: "🔔", admin: true, mobile: true },
  { href: "/events", label: "Event Logs", short: "Events", icon: "📊", mobile: true },
  { href: "/users", label: "Users", short: "Users", icon: "👥", admin: true },
  { href: "/diagnostics", label: "Diagnostics", short: "Diagnostics", icon: "🔬", admin: true },
  { href: "/account", label: "Account", short: "Account", icon: "👤" },
];

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));
