export type TrustedPublicKeys = Record<string, string>;

const BUILT_IN_DEV_PUBLIC_KEYS: TrustedPublicKeys = {
  // dev-only key for local testing. Replace in production builds via VITE_KMIND_ZEN_LICENSE_PUBKEYS.
  "dev-1": "8atDk2ATygOWWtVklucoy/3lOWKB57BoU7DvFy8ta2Y=",
};

export function resolveTrustedPublicKeys(): TrustedPublicKeys {
  const injected =
    typeof __KMIND_ZEN_LICENSE_PUBKEYS__ === "object" && __KMIND_ZEN_LICENSE_PUBKEYS__
      ? (__KMIND_ZEN_LICENSE_PUBKEYS__ as TrustedPublicKeys)
      : null;

  if (injected && Object.keys(injected).length > 0) return injected;
  if (__KMIND_ZEN_BUILD_PROFILE__ === "dev") return BUILT_IN_DEV_PUBLIC_KEYS;
  return {};
}

