# Karen VPS Technical Postmortem — 2026-09-30

> مبنای زمانی: ایران (UTC+03:30)
> وضعیت: هیچ اتصال remote موفق Shadowsocks/REALITY روی VPS جدید تأیید نشد.

## Timeline
- **04:15** — ورود به حساب آریانت؛ زمان از ایمیل امنیتی.
- **05:31** — acceptance evidence اولیه در GitHub.
- **05:32** — Restore Point روی VPS: `karen-vps-state-20260930T020227Z.tar.gz`.
- **07:30** — cut-off اعلام‌شده توسط کاربر.
- زمان خرید دقیق در آثار موجود پیدا نشد؛ فقط می‌توان آن را بین **04:15 و حداکثر 05:31** محدود کرد.
- مدت ورود تا cut-off: **3h15m**.

## Server
- Arianet/Ariaservice → Hetzner Falkenstein
- service-060c83 / CX23
- Ubuntu 24.04 x86_64
- 2 vCPU / 4 GB RAM / 40 GB NVMe
- IPv4: 91.107.140.178
- IPv6: 2a01:4f8:c010:2128::1

## Key network evidence
- SSH worked.
- Docker/Karen Fuse local HTTP 200.
- GitHub/API/Registry outbound reachable.
- Raw Shadowsocks local self-test succeeded.
- Remote Shadowsocks on 443 failed.
- During controlled phone attempts to 443, some tcpdump captures showed no matching packet at eth0.
- A phone-2 probe to the **same VPS IPv4** on TCP/31457 produced a real packet at eth0 from 5.123.219.83.
- Therefore the VPS/IP was not proven globally unreachable.
- No baseline ICMP ping/traceroute/TCP reachability matrix was recorded at the start — a major diagnostic omission.

## Proxy tests
1. raw shadowsocks-libev / chacha20-ietf-poly1305 / 443 — local PASS, remote FAIL.
2. 3x-ui Shadowsocks / AES-256-GCM / 443 — remote FAIL.
3. VLESS + REALITY + Vision / TCP 443 / chrome / Microsoft target — server PASS, remote FAIL.
4. VLESS + REALITY / no flow / random / play.google.com / TCP 443 — target scan PASS, xray tls ping PASS, listener PASS, remote FAIL.

## User working references
- SS reference: first hop pinned to 62.60.163.36 (Iran), raw SS/TCP 443, no TLS/Reality/WS/gRPC/XHTTP at client.
- REALITY reference: 51.38.160.53 (OVH), direct foreign VLESS/TCP/443/REALITY, no flow, random fingerprint, play.google.com.

## Process failures
- Protocol-first instead of reachability/topology-first.
- No ping/traceroute/TCP matrix before protocol changes.
- Overinterpretation of one working SS topology; later corrected after direct-foreign reference.
- Multiple script/config repair cycles before CI became mandatory.
- 32 infra/analysis commits in the test branch; at least 12 were fix/correction/repair class.
- Cloudflare/classic TLS was not part of the initial bounded test matrix.

## Restore point
- `/root/karen-backups/karen-vps-state-20260930T020227Z.tar.gz`
- SHA-256: `567d6252ee5fa024ff176caa5d199d9b0119f30be84050c2d0016d4886d4ad0e`
- Contains secrets. **Do not put in public GitHub.**
