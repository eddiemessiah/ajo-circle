# Ajo Circle

A Telegram agent that runs rotating savings circles (ajo, esusu, chama, stokvel) for groups that already save together. Each round, one member receives the pot. Everyone else pays that member **directly from their own wallet** in USDT, USA₮ or cNGN on Celo. The agent schedules rounds, sends pay links, reminds late payers and verifies every payment on-chain. **It never holds anyone's money.**

Built for the Celo **Agents at Work** hackathon (primary track: Value Moved) by builders from the Next Gen Summit community.

## Why

Millions of people across West Africa run ajo circles over WhatsApp and Telegram. They rely on one trusted organiser to collect cash, keep a notebook and chase late payers. That organiser is the single point of failure: money goes missing, records get disputed, people fall behind. Ajo Circle keeps the social contract and replaces the notebook and the collector:

- **No custody.** Money moves member → member in one transfer. There's no pooled wallet to be drained.
- **A shared, verifiable record.** Every contribution is a tagged on-chain transfer the whole group can trust.
- **The nagging is automated.** The agent knows who hasn't paid and reminds them.

## How it works

```
/newcircle 20 USDT Friday Ajo   → circle created in the group
/join                           → member joins; connects a wallet in a private chat (no signature needed)
/begin                          → payout order locked (join order); round 1 announced with a "Pay my share" button
Pay page (in the member's wallet) → pre-flight balance + network fee → tagged ERC-20 transfer to this round's recipient
Server                          → reads the Transfer log from the receipt, checks the tag, records it, posts in the group
All paid                        → next round announced automatically; circle completes after every member has received once
```

| Rail | Token | Where it works |
|---|---|---|
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (6 dp) | MiniPay (network fee paid in USDT via the CIP-64 adapter) and any Celo wallet |
| USA₮ | `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` (6 dp) | Celo wallets outside MiniPay |
| cNGN | `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` (6 dp) | Celo wallets outside MiniPay |

MiniPay rules this code follows: auto-connect, no `personal_sign`, the wallet address is never shown on screen, pre-flight against amount + network fee with a redirect to Deposit, and pending / success / failure states with errors mapped from error codes.

## Run it

```bash
npm install
cp .env.example .env          # add TELEGRAM_BOT_TOKEN and PUBLIC_BASE_URL
npm run wallet                # creates the agent wallet; key stays in .env
npm run register-agent        # dry run: shows the ERC-8004 metadata and fee
npm run register-agent -- --send   # registers the agent on Celo mainnet
npm run dev
```

Agent skills used to build this (pinned in `skills-lock.json`):

```bash
npx skills add celo-org/celopedia-skills
npx skills add https://celobuilders.xyz
```

Telegram buttons need a public https URL. For a local demo, expose port 8787 with a tunnel (for example `cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_BASE_URL` to it.

**Attribution.** Put the tag from the Celo Builders registration in `ATTRIBUTION_TAG` *before* anyone pays. Pay pages refuse to send without it, because an untagged transaction can never be counted. Check the first payment with:

```bash
npm run verify-tag -- 0x<tx hash>
```

## Known limits (honest list)

- MiniPay's "open in MiniPay" deeplink only works for approved Mini Apps. Until Ajo Circle is listed, MiniPay users open the pay link through MiniPay's site tester. Everyone else uses their wallet's built-in browser.
- Storage is a JSON file. That's fine for pilot circles; move to a database before real scale.
- Late or missed payments are reminded, not enforced. There's no collateral in v1.

## Roadmap

- **Self proof-of-personhood** so each seat in a circle is one real human.
- **x402 contribution-record API (USA₮):** with a member's consent, lenders and other agents can pay per request for an on-time payment history, turning ajo discipline into portable credit.
- Scheduled reminders ahead of the due date, and a group payout summary when a circle completes.
