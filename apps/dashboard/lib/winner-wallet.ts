export interface ChainWallet {
  chain: string;
}

/**
 * Resolve a winner wallet without ever crossing the raffle's chain boundary.
 * A raffle-specific submission wins when valid; otherwise only a saved profile
 * matching one of the configured chains may be used.
 */
export function selectConfiguredWallet<
  S extends ChainWallet,
  P extends ChainWallet,
>(
  submitted: S | null | undefined,
  profiles: readonly P[],
  configuredChains: readonly string[],
): S | P | null {
  if (
    submitted &&
    (configuredChains.length === 0 ||
      configuredChains.includes(submitted.chain))
  ) {
    return submitted;
  }

  for (const chain of configuredChains) {
    const profile = profiles.find((item) => item.chain === chain);
    if (profile) return profile;
  }
  return null;
}

export function walletMatchesConfiguredChains(
  chain: string,
  configuredChains: readonly string[],
): boolean {
  return configuredChains.length === 0 || configuredChains.includes(chain);
}
