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


## Candidate architecture — not yet selected

A two-node Layer-4 relay topology is one plausible reproduction of the working reference, but it is **not yet justified as the project architecture**. The reference profile proves that this topology works for that service; it does not prove that an Iranian ingress is necessary for Karen Lab.

```
Android client
  -> domain:443
  -> Iran ingress public IPv4
  -> HAProxy TCP relay
  -> Hetzner origin/backend on a dedicated TCP port
  -> Xray Shadowsocks inbound
  -> Internet
```

Design rules:
- Keep the client-facing port at TCP/443.
- For the first acceptance run, keep the same Shadowsocks method and raw TCP shape as the known-working reference, while generating a new private password.
- The Iran node does not terminate Shadowsocks; it relays the encrypted TCP payload at Layer 4.
- Bind the Hetzner backend Shadowsocks port so that its firewall accepts it only from the Iran ingress public IPv4.
- The public domain should resolve to the Iran ingress, not directly to the Hetzner origin.
- Do not introduce a normal HTTP CDN in the first reproduction. Raw Shadowsocks/TCP is not an HTTP payload and an ordinary HTTP CDN is a different topology.
- If the Iran-to-Hetzner direct server path is unreliable, the next fallback is a persistent server-to-server tunnel/reverse path; do not change the client protocol first.

Do not purchase or provision an Iranian VPS on the basis of this reference alone. Before selecting an architecture, compare at least one known-working profile that reaches a foreign server directly (preferably the user's working REALITY/direct-IP example). The project architecture should be selected from the common requirements of multiple working topologies, not copied from a single reference.


## Working direct-foreign REALITY reference

A second known-working profile disproves any requirement for an Iranian ingress.

Observed client configuration:
- VLESS to `fr-static.gozaronline.net:443`
- Xray hosts pin: `fr-static.gozaronline.net -> 51.38.160.53`
- `51.38.160.53` is in OVH AS16276 (foreign datacenter network)
- transport: TCP/RAW
- security: REALITY
- REALITY serverName: `play.google.com`
- fingerprint: `random`
- shortId length: 6 hex chars
- spiderX: `/`
- no client `flow` field (therefore not Vision in this exported profile)
- mux disabled
- UDP/443 blocked in client routing

Comparison with Karen Lab failed REALITY:
- Both use a direct foreign first hop on TCP/443 and REALITY over TCP/RAW.
- Karen Lab used Hetzner `91.107.140.178:443`; reference uses OVH `51.38.160.53:443`.
- Karen Lab profile used `flow=xtls-rprx-vision`; working reference has no flow.
- Karen Lab used fingerprint `chrome`; working reference uses `random`.
- Karen Lab selected Microsoft target/SNI; working reference uses `play.google.com` as client SNI (server-side target is not visible in client JSON).
- The working reference statically pins its public hostname to the foreign origin IP in Xray DNS.

Conclusion:
- An Iranian ingress is not required.
- A normal CDN is not required by this successful direct-foreign reference.
- The current Hetzner VPS remains a valid candidate.
- The next experiment should reproduce the **working REALITY profile shape** on the existing Hetzner server before buying another VPS: direct TCP/443, no Vision flow, fingerprint random, controlled REALITY target/SNI selected and validated server-side, and matching client routing/DNS behavior.
- Change this configuration family as a unit; do not resume random port/cipher cycling.


## Controlled direct-REALITY reproduction result

The reference-shaped direct REALITY test on the existing Hetzner VPS was completed server-side and then failed from the Android client.

Server-side test shape:
- endpoint: `91.107.140.178:443`
- VLESS + TCP/RAW + REALITY
- no Vision flow
- fingerprint: `random`
- SNI/target: `play.google.com / play.google.com:443`
- 6-hex short ID
- target feasibility scan: passed
- `xray tls ping`: passed
- stored 3x-ui profile verification: passed
- TCP/443 listener verification: passed
- Android remote connection: **failed**

This means the failed Karen Lab result cannot be explained only by the previously observed differences in Vision flow, fingerprint, short-ID length, or the Microsoft-vs-Google REALITY target choice.

No X.509 certificate was issued or installed for this test. REALITY does not use a server-owned public certificate in the same way as ordinary TLS; it uses the target site's TLS appearance/handshake characteristics.

## Next architecture under evaluation: Cloudflare-fronted TLS

Do not continue random REALITY parameter changes.

The next materially different topology to test is:

```
Android
  -> Cloudflare edge on HTTPS/443
  -> Cloudflare-to-origin TLS
  -> Nginx on the existing Hetzner VPS
  -> path-based reverse proxy
  -> local Xray VLESS transport
  -> Internet
```

For the first CDN-fronted acceptance test, use a transport Cloudflare explicitly proxies reliably (WebSocket over HTTPS) as the baseline. Once the CDN/TLS path is proven, XHTTP can be evaluated without changing the edge/origin certificate architecture.

Requirements before deployment:
- a domain controlled by the user and active in Cloudflare
- a proxied hostname for the test
- Cloudflare edge certificate (normally Universal SSL, managed by Cloudflare)
- an origin certificate/private key installed only on the Hetzner origin, preferably Cloudflare Origin CA
- Cloudflare SSL mode Full (strict)

The client SNI in this topology is the user's Cloudflare hostname, not a REALITY camouflage name such as `play.google.com`.
