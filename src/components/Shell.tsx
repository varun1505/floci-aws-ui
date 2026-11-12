import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import AppLayout, { type AppLayoutProps } from "@cloudscape-design/components/app-layout";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Flashbar from "@cloudscape-design/components/flashbar";
import SideNavigation, { type SideNavigationProps } from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { REGIONS, getRegion, setRegion } from "../aws";
import { useNotify } from "../lib/notify";
import { useFollow } from "./RouterLink";

export type Service = "home" | "lambda" | "s3" | "cloudwatch" | "ec2";

export const SERVICES: { id: Exclude<Service, "home">; name: string; href: string; description: string }[] = [
  { id: "ec2", name: "EC2", href: "/ec2/instances", description: "Virtual servers" },
  { id: "lambda", name: "Lambda", href: "/lambda/functions", description: "Run code without servers" },
  { id: "s3", name: "S3", href: "/s3/buckets", description: "Object storage" },
  { id: "cloudwatch", name: "CloudWatch", href: "/cloudwatch/log-groups", description: "Logs, metrics and alarms" },
];

const NAV: Record<Service, { header: SideNavigationProps.Header; items: SideNavigationProps.Item[] }> = {
  home: {
    header: { text: "Console Home", href: "/" },
    items: SERVICES.map((s) => ({ type: "link", text: s.name, href: s.href })),
  },
  lambda: {
    header: { text: "Lambda", href: "/lambda/functions" },
    items: [{ type: "link", text: "Functions", href: "/lambda/functions" }],
  },
  s3: {
    header: { text: "Amazon S3", href: "/s3/buckets" },
    items: [{ type: "link", text: "General purpose buckets", href: "/s3/buckets" }],
  },
  cloudwatch: {
    header: { text: "CloudWatch", href: "/cloudwatch/log-groups" },
    items: [
      {
        type: "section",
        text: "Logs",
        items: [{ type: "link", text: "Log groups", href: "/cloudwatch/log-groups" }],
      },
      {
        type: "section",
        text: "Alarms",
        items: [{ type: "link", text: "All alarms", href: "/cloudwatch/alarms" }],
      },
      {
        type: "section",
        text: "Metrics",
        items: [{ type: "link", text: "All metrics", href: "/cloudwatch/metrics" }],
      },
    ],
  },
  ec2: {
    header: { text: "EC2", href: "/ec2/instances" },
    items: [
      {
        type: "section",
        text: "Instances",
        items: [{ type: "link", text: "Instances", href: "/ec2/instances" }],
      },
      {
        type: "section",
        text: "Images",
        items: [{ type: "link", text: "AMIs", href: "/ec2/images" }],
      },
      {
        type: "section",
        text: "Network & Security",
        items: [
          { type: "link", text: "Security Groups", href: "/ec2/security-groups" },
          { type: "link", text: "Key Pairs", href: "/ec2/key-pairs" },
        ],
      },
    ],
  },
};

function initialMode(): Mode {
  try {
    return localStorage.getItem("mode") === "dark" ? Mode.Dark : Mode.Light;
  } catch {
    return Mode.Light;
  }
}

// Kept outside React so the side navigation stays open or closed across pages.
let navOpenState = true;

let currentMode = initialMode();
applyMode(currentMode);

function TopBar() {
  const follow = useFollow();
  const [mode, setMode] = useState(currentMode);
  const region = getRegion();
  const regionLabel = REGIONS.find((r) => r.id === region)?.label ?? region;

  const toggleMode = () => {
    const next = mode === Mode.Dark ? Mode.Light : Mode.Dark;
    currentMode = next;
    applyMode(next);
    setMode(next);
    try {
      localStorage.setItem("mode", next);
    } catch {
      /* ignore */
    }
  };

  return (
    <TopNavigation
      identity={{ href: "/", title: "Floci Console", onFollow: (e) => follow(e as never) }}
      utilities={[
        {
          type: "menu-dropdown",
          text: "Services",
          iconName: "view-full",
          items: SERVICES.map((s) => ({ id: s.href, text: s.name, description: s.description, href: s.href })),
          onItemFollow: (e) => follow(e as never),
        },
        {
          type: "button",
          iconName: mode === Mode.Dark ? "star-filled" : "star",
          text: mode === Mode.Dark ? "Light mode" : "Dark mode",
          onClick: toggleMode,
        },
        {
          type: "menu-dropdown",
          text: regionLabel,
          description: "Region",
          items: REGIONS.map((r) => ({ id: r.id, text: r.label, description: r.id, disabled: r.id === region })),
          onItemClick: (e) => setRegion(e.detail.id),
        },
        {
          type: "menu-dropdown",
          text: "non-prod",
          description: "On-prem non-production environment. Account 000000000000.",
          iconName: "user-profile",
          items: [{ id: "floci", text: "Emulator dashboard", href: "/aws/_floci/ui", external: true }],
        },
      ]}
    />
  );
}

export function Shell({
  service,
  breadcrumbs,
  children,
  contentType = "default",
  splitPanel,
  splitPanelOpen,
  onSplitPanelToggle,
}: {
  service: Service;
  breadcrumbs: { text: string; href: string }[];
  children: ReactNode;
  contentType?: AppLayoutProps.ContentType;
  splitPanel?: ReactNode;
  splitPanelOpen?: boolean;
  onSplitPanelToggle?: (open: boolean) => void;
}) {
  const follow = useFollow();
  const location = useLocation();
  const notify = useNotify();
  const [navOpen, setNavOpenLocal] = useState(navOpenState);
  const setNavOpen = (open: boolean) => {
    navOpenState = open;
    setNavOpenLocal(open);
  };
  const nav = NAV[service];
  const topNav = document.getElementById("top-nav");

  // Highlight the side-nav item whose href starts the current path.
  const flat = nav.items.flatMap((i) => (i.type === "section" ? i.items : [i])) as { href?: string }[];
  // Detail pages use singular paths (/s3/bucket) under a plural list (/s3/buckets), so match both ways.
  const hrefs = flat.map((i) => i.href ?? "").filter(Boolean);
  const active =
    hrefs.filter((h) => location.pathname.startsWith(h) || h.startsWith(location.pathname)).sort((a, b) => b.length - a.length)[0] ??
    (service === "home" ? undefined : hrefs[0]);

  return (
    <>
      {topNav && createPortal(<TopBar />, topNav)}
      <AppLayout
        headerSelector="#top-nav"
        contentType={contentType}
        navigationOpen={navOpen}
        onNavigationChange={(e) => setNavOpen(e.detail.open)}
        navigation={<SideNavigation header={nav.header} items={nav.items} activeHref={active} onFollow={follow} />}
        breadcrumbs={
          <BreadcrumbGroup
            items={[{ text: "Console Home", href: "/" }, ...breadcrumbs]}
            onFollow={follow}
            ariaLabel="Breadcrumbs"
          />
        }
        notifications={<Flashbar items={notify.items} stackItems />}
        toolsHide
        splitPanel={splitPanel}
        splitPanelOpen={splitPanelOpen}
        onSplitPanelToggle={(e) => onSplitPanelToggle?.(e.detail.open)}
        content={children}
      />
    </>
  );
}
