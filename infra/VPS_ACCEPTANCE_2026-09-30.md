# VPS Acceptance — 2026-09-30

Status: **Acceptance pending — no successful remote proxy connection has been confirmed yet**

## Server
- Provider panel: Arianet / Ariaservice
- Upstream/location: Hetzner, Falkenstein
- Service: service-060c83
- Plan: CX23
- OS: Ubuntu 24.04 x86_64
- Resources: 2 vCPU / 4 GB RAM / 40 GB NVMe
- Public IPv4: 91.107.140.178

## Acceptance evidence
- Root/SSH access works.
- Docker, Git and UFW installed successfully.
- Karen Fuse container runs and returns HTTP 200 locally.
- Outbound access to GitHub, GitHub API and Docker Registry works.
- Xray / 3x-ui is installed and running.
- VLESS + REALITY + Vision on TCP/443 was created successfully and imported on the remote Android client.
- VLESS + REALITY was imported on the remote Android client, but **no successful remote connection has been confirmed**.
- A controlled second REALITY test reproduced the known-working client shape on the Hetzner VPS (TCP/443, REALITY, no Vision flow, fingerprint random, play.google.com target/SNI). All server-side validations passed, but the Android remote connection still failed. End-to-end remote acceptance remains unresolved.

## Current proxy state
- VLESS + REALITY owns TCP/443.
- The prior Shadowsocks inbound is preserved but parked on TCP/24443 while REALITY is tested.
- No credentials, UUIDs, private keys, share links or API tokens are stored in this repository note.

## Decision
No final VPS acceptance decision yet. Do not continue random direct-REALITY tuning. The next architecture to evaluate is a domain-based Cloudflare-fronted TLS path on the same Hetzner origin, so the first hop and certificate topology materially differ from the failed direct-IP tests.

## Pending
- Baseline sensitive VPS state backup created on-server at `2026-09-30T02:02:27Z`.
- Backup SHA-256: `567d6252ee5fa024ff176caa5d199d9b0119f30be84050c2d0016d4886d4ad0e`.
- Export backup off-server.
- Close unnecessary public management ports after backup.
- Final acceptance snapshot should be archived as RTL Persian PDF + DOCX with SHA-256 manifest according to Karen Lab archive policy.


## Firewall cleanup progress
- Removed stale public TCP/31457 rule (IPv4 + IPv6).
- Removed public 3x-ui panel TCP/54036 rule (IPv4 + IPv6).
- SSH TCP/22 remains open.
- TCP/443 remains open for VLESS + REALITY.
- TCP/80 and UDP/443 are still pending review; they have not been closed yet.
