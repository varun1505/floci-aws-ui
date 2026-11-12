import Link, { type LinkProps } from "@cloudscape-design/components/link";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

/** A Cloudscape link that moves between console pages without a full page load. */
export function RouterLink({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<LinkProps, "href" | "onFollow">) {
  const navigate = useNavigate();
  return (
    <Link
      {...rest}
      href={to}
      onFollow={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </Link>
  );
}

/** onFollow handler for Cloudscape components that take hrefs (buttons, breadcrumbs, side nav). */
export function useFollow() {
  const navigate = useNavigate();
  return (e: CustomEvent<{ href?: string; external?: boolean }>) => {
    const href = e.detail.href;
    if (!href || e.detail.external || /^https?:/.test(href)) return;
    e.preventDefault();
    navigate(href);
  };
}
