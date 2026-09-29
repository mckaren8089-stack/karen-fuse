# Karen Lab VPS bootstrap test

This directory is the non-production bootstrap path for the first Karen Lab VPS acceptance test.

## Scope

- Ubuntu 24.04 x86
- Docker bootstrap
- Basic firewall: SSH, HTTP, HTTPS
- Karen Fuse static web test on port 80
- Outbound connectivity checks for GitHub and Docker Registry

No secrets, passwords, SSH private keys, tokens, or production credentials belong in this repository.

The branch `infra/bootstrap-vps-test` is intentionally isolated from `main`.
