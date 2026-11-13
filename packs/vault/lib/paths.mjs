// Shared locations. The client (the nano user) and the daemon must agree on the
// socket path. The client ignores its own environment so it cannot point itself
// at a socket it created. Keep the uid in install.sh and start-root.sh in sync.

export const VAULT_UID = 10001;
export const VAULT_GID = 10001;
export const VAULT_RUN_DIR = "/run/nano-vault";
export const VAULT_SOCKET = "/run/nano-vault/vault.sock";
export const DEFAULT_VAULT_DIR = "/vault";
export const DEFAULT_DOWNLOADS = "/var/lib/nano-vault/downloads";
export const DEFAULT_PORT = 8484;
