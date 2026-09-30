# Working Reference Config Analysis — sb31.refreshping.com

Date: 2026-09-30

## Key finding

The working Android/Xray profile does **not** connect directly to the foreign Karen Lab VPS.

The profile contains a static Xray DNS host mapping:

- `sb31.refreshping.com -> 62.60.163.36`

and the Shadowsocks outbound uses:

- address: `sb31.refreshping.com`
- port: `443`
- method: `aes-256-gcm`
- transport: TCP
- TCP header: none
- mux: disabled
- socket domain strategy: UseIP

The client-side stream settings contain no TLS, REALITY, WebSocket, gRPC, xHTTP, or SIP003 plugin layer.

Current public routing data places `62.60.163.0/24` in Iranian network AS214922 (FanAvaran Mihan Mizban PJSC). Therefore the working profile's first network hop is a reachable Iranian ingress address, not the foreign origin IP.

## What this proves

The key architectural difference from the Karen Lab test profiles is first-hop topology:

- Working reference: Android client -> Iranian ingress `62.60.163.36:443` -> server-side path unknown from client JSON.
- Karen Lab Shadowsocks/REALITY tests: Android client -> foreign Hetzner IPv4 `91.107.140.178:443` directly.

The exact server-side path behind `62.60.163.36` cannot be determined from the client JSON alone. It may be a relay/reverse tunnel, a routed gateway, or a host with a different egress path. The client configuration itself does not demonstrate a CDN.

## Other relevant client behavior

- UDP/443 is blocked in routing, which prevents QUIC traffic and encourages TCP fallback for applications.
- Foreign DNS traffic is routed through the proxy; domestic/private DNS and destinations are selectively direct.
- The static host mapping removes dependency on public DNS for the proxy server hostname.
- Happy Eyeballs is configured, but the proxy hostname is statically pinned to one IPv4 address in this profile.

## Consequence for Karen Lab

Do not spend more time changing Shadowsocks ciphers or random ports on the same direct foreign-IP topology.

A domain pointed directly at `91.107.140.178` would preserve the same first-hop topology and is not expected to reproduce the reference architecture by itself.

The next design step is to choose and implement a reachable ingress/front layer for the existing foreign VPS, then test one controlled configuration end-to-end.
