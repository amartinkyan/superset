# Linear Local Testing

Local Linear testing needs two different base URLs:

- OAuth callback traffic should keep using `NEXT_PUBLIC_API_URL` so the browser returns directly to your local API.
- Server-to-server traffic should use `LINEAR_PUBLIC_API_URL` so Linear webhooks and QStash jobs can reach your machine.

The code now reads `LINEAR_PUBLIC_API_URL` only for the Linear webhook and Linear-triggered background jobs. No manual hard-coding is required.
The tunnel provider does not matter as long as it forwards to your local API origin.

## One-time setup

If you plan to use the bundled `bun run dev:linear` command, install ngrok and
make sure the ngrok account on your machine is authenticated and verified.

1. Reserve an ngrok URL if you want a stable webhook endpoint.
2. Optionally set `LINEAR_PUBLIC_API_URL=https://your-reserved-domain.ngrok.app` in `.env`.
   If you leave it blank, `bun run dev:linear` will generate an ngrok URL and
   write it back into `.env` for you.
3. In the Linear OAuth application, add your local callback URL:

```text
http://localhost:3001/api/integrations/linear/callback
```

If you use a different local API origin, use:

```text
${NEXT_PUBLIC_API_URL}/api/integrations/linear/callback
```

4. In the Linear webhook configuration, set:

```text
${LINEAR_PUBLIC_API_URL}/api/integrations/linear/webhook
```

## Daily dev loop

Run:

```bash
bun run dev:linear
```

That command:

- starts an ngrok tunnel to your local API
- waits until the requested paid ngrok hostname is actually live before continuing
- persists the resolved `LINEAR_PUBLIC_API_URL` into the root `.env`
- exports `LINEAR_PUBLIC_API_URL` for the local dev servers
- prints the exact callback and webhook URLs in use
- starts the normal Superset dev stack

If you already use Cloudflare Tunnel or another provider, keep `LINEAR_PUBLIC_API_URL`
pointed at that tunnel and use your normal tunnel command instead.

If you already have the dev servers running and only need the tunnel, use:

```bash
bun run dev:linear:tunnel
```

## Stable vs ephemeral tunnels

- If `LINEAR_PUBLIC_API_URL` is set, `dev:linear` asks ngrok to use that URL.
- If `LINEAR_PUBLIC_API_URL` is unset, `dev:linear` creates an ephemeral ngrok URL, writes it into `.env`, and exports it for the current run. The webhook URL will change the next time you run it.

For the smoothest local loop, reserve one ngrok domain and keep it in `.env`.
