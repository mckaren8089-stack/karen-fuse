# VPS Acceptance — 2026-09-30

Status: **Accepted for Karen Lab testing and migration work**

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
- Remote REALITY connection succeeded.
- Earlier Shadowsocks failures did not establish a VPS health failure; server-side listeners and local proxy tests were healthy. The remaining issue was in the connection/configuration path rather than the VPS resource itself.

## Current proxy state
- VLESS + REALITY owns TCP/443.
- The prior Shadowsocks inbound is preserved but parked on TCP/24443 while REALITY is tested.
- No credentials, UUIDs, private keys, share links or API tokens are stored in this repository note.

## Decision
The VPS is suitable to keep for the next phase. Further work should focus on reproducible client/server configuration, backup/restore readiness, and reducing public management-plane exposure.

## Pending
- Baseline sensitive VPS state backup created on-server at `2026-09-30T02:02:27Z`.
- Backup SHA-256: `567d6252ee5fa024ff176caa5d199d9b0119f30be84050c2d0016d4886d4ad0e`.
- Export backup off-server.
- Close unnecessary public management ports after backup.
- Final acceptance snapshot should be archived as RTL Persian PDF + DOCX with SHA-256 manifest according to Karen Lab archive policy.
