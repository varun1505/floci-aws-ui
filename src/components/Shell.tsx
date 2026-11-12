import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import AppLayout, { type AppLayoutProps } from "@cloudscape-design/components/app-layout";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Flashbar from "@cloudscape-design/components/flashbar";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { ACCOUNT_ID, PROXY_BASE, REGIONS, getRegion, setRegion } from "../config";
import { useNotify } from "../lib/notify";
import { ServiceHelp } from "./help";
import { NAV, SERVICES, markVisited, searchIndex, type Service } from "./nav";
import { useFollow } from "./RouterLink";

export { SERVICES, type Service } from "./nav";

function initialMode(): Mode {
  try {
    return localStorage.getItem("mode") === "dark" ? Mode.Dark : Mode.Light;
  } catch {
    return Mode.Light;
  }
}

// Kept outside React so these survive moving between pages.
let navOpenState = true;
let toolsOpenState = false;
let currentMode = initialMode();
applyMode(currentMode);

function Search() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  return (
    <Autosuggest
      value={value}
      onChange={(e) => setValue(e.detail.value)}
      onSelect={(e) => {
        setValue("");
        navigate(e.detail.value);
      }}
      options={searchIndex()}
      placeholder="Search for services and features"
      ariaLabel="Search for services and features"
      enteredTextLabel={(v) => `Search for "${v}"`}
      empty="No services or features match."
      filteringType="auto"
    />
  );
}

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
      search={<Search />}
      utilities={[
        {
          type: "menu-dropdown",
          text: "Services",
          iconName: "view-full",
          items: SERVICES.map((s) => ({ id: s.href, text: s.fullName, description: s.description, href: s.href })),
          onItemFollow: (e) => follow(e as never),
        },
        {
          type: "button",
          iconName: mode === Mode.Dark ? "star-filled" : "star",
          title: mode === Mode.Dark ? "Switch to light mode" : "Switch to dark mode",
          ariaLabel: mode === Mode.Dark ? "Switch to light mode" : "Switch to dark mode",
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
          description: `Account ID: ${ACCOUNT_ID}`,
          iconName: "user-profile",
          items: [{ id: "floci", text: "Emulator dashboard", href: "/aws/_floci/ui", external: true }],
        },
      ]}
    />
  );
}

function Footer() {
  const bar = {
    display: "flex",
    gap: 24,
    alignItems: "center",
    padding: "6px 24px",
    fontSize: 12,
    fontFamily: '"Open Sans", "Helvetica Neue", Roboto, Arial, sans-serif',
    background: "#161d26",
    color: "#c6c6cd",
    flexWrap: "wrap",
  } as const;
  return (
    <div style={bar}>
      <span>Floci Console</span>
      <span>On-prem non-production environment</span>
      <span style={{ marginLeft: "auto" }}>
        API endpoint: <code style={{ color: "#fff" }}>{PROXY_BASE}</code>
      </span>
      <span>
        Region: <code style={{ color: "#fff" }}>{getRegion()}</code>
      </span>
    </div>
  );
}

export function Shell({
  service,
  breadcrumbs,
  children,
  contentType = "default",
}: {
  service: Service;
  breadcrumbs: { text: string; href: string }[];
  children: ReactNode;
  contentType?: AppLayoutProps.ContentType;
}) {
  const follow = useFollow();
  const location = useLocation();
  const notify = useNotify();
  const [navOpen, setNavOpenLocal] = useState(navOpenState);
  const [toolsOpen, setToolsOpenLocal] = useState(toolsOpenState);
  const nav = NAV[service];
  const topNav = document.getElementById("top-nav");
  const footer = document.getElementById("footer");

  useEffect(() => {
    if (service !== "home") markVisited(service);
  }, [service]);

  // Highlight the side-nav item for the current page. Detail pages use singular paths
  // (/s3/bucket) under a plural list (/s3/buckets), so match both ways.
  const hrefs = nav.items.flatMap((i) => (i.type === "section" ? i.items : [i])).map((i) => ("href" in i ? i.href : "")).filter(Boolean);
  const path = location.pathname;
  const active =
    service === "home"
      ? undefined
      : hrefs.find((h) => h === path) ??
        hrefs.filter((h) => path.startsWith(h) || h.startsWith(path)).sort((a, b) => b.length - a.length)[0] ??
        hrefs.find((h) => h.startsWith(`/${service}/`) && !h.endsWith("/home"));

  return (
    <>
      {topNav && createPortal(<TopBar />, topNav)}
      {footer && createPortal(<Footer />, footer)}
      <AppLayout
        headerSelector="#top-nav"
        footerSelector="#footer"
        ariaLabels={{
          navigation: "Side navigation",
          navigationClose: "Close side navigation",
          navigationToggle: "Open side navigation",
          tools: "Help panel",
          toolsClose: "Close help panel",
          toolsToggle: "Open help panel",
          notifications: "Notifications",
        }}
        contentType={contentType}
        navigationOpen={navOpen}
        onNavigationChange={(e) => {
          navOpenState = e.detail.open;
          setNavOpenLocal(e.detail.open);
        }}
        navigation={<SideNavigation header={nav.header} items={nav.items} activeHref={active} onFollow={follow} />}
        breadcrumbs={
          <BreadcrumbGroup items={[{ text: "Console Home", href: "/" }, ...breadcrumbs]} onFollow={follow} ariaLabel="Breadcrumbs" />
        }
        notifications={<Flashbar items={notify.items} stackItems />}
        tools={<ServiceHelp service={service} />}
        toolsOpen={toolsOpen}
        onToolsChange={(e) => {
          toolsOpenState = e.detail.open;
          setToolsOpenLocal(e.detail.open);
        }}
        content={children}
      />
    </>
  );
}
