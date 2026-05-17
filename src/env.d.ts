declare const __KMIND_ZEN_API_BASE__: string;
declare const __KMIND_ZEN_API_ENV__: string;
declare const __KMIND_ZEN_BUILD_PROFILE__: "dev" | "prod";
declare const __KMIND_ZEN_LICENSE_PUBKEYS__: Record<string, string> | null | undefined;
declare const __KMIND_ZEN_APP_VERSION__: string;
declare const __KMIND_ZEN_CORE_VERSION__: string;
declare const __KMIND_ZEN_WEBSITE_URL__: string;

declare module "*.svg?raw" {
  const content: string;
  export default content;
}
