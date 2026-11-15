const defaultSiteUrl = "https://cafe-vi.vercel.app";

export function getAuthRedirectUrl(path: string) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl;
  const siteUrl = new URL(configuredSiteUrl);

  if (
    siteUrl.protocol !== "https:"
    || siteUrl.hostname === "localhost"
    || siteUrl.hostname.endsWith(".localhost")
    || siteUrl.hostname === "127.0.0.1"
    || siteUrl.hostname === "[::1]"
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a hosted HTTPS URL.");
  }

  return new URL(path, siteUrl.origin).toString();
}
