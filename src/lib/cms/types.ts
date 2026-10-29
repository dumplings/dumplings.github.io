export type SiteId = "personal-site" | "demo-b2b";
export type HomeContentType = "personal-home" | "b2b-home";

export interface HomeContent {
  headline: string;
  description: string | null;
}

export type HomeResult =
  | { status: "found"; locale: string; content: HomeContent }
  | { status: "missing"; locale: string };

export interface SiteLocale {
  siteId: SiteId;
  strapiLocale: string;
  urlSegment: string;
  enabled: boolean;
  direction: "ltr" | "rtl";
  isDefault: boolean;
}

export type CmsErrorKind =
  | "configuration"
  | "network"
  | "timeout"
  | "authorization"
  | "http"
  | "invalid-response";

/** Contains only controlled messages, never request details or upstream causes. */
export class CmsError extends Error {
  readonly kind: CmsErrorKind;
  readonly status: number | undefined;

  constructor(kind: CmsErrorKind, message: string, status?: number) {
    super(message);
    this.name = "CmsError";
    this.kind = kind;
    this.status = status;
  }
}

/** Raw REST payloads stop at the Adapter; consumers receive domain objects. */
export interface CmsClient {
  getSingleType(type: HomeContentType, locale: string): Promise<unknown>;
  getSiteLocales(siteId: SiteId): Promise<unknown[]>;
}

export interface CmsAdapter {
  getHome(locale: string): Promise<HomeResult>;
  getSiteLocales(): Promise<SiteLocale[]>;
}
