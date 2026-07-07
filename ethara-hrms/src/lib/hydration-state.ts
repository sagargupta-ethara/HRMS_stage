let hasClientHydrated = false;

export function markClientHydrated(): void {
  hasClientHydrated = true;
}

export function hasHydratedOnClient(): boolean {
  return hasClientHydrated;
}
