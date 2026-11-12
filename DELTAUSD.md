# DeltaUSD Yields adapter preparation

Status: working preparation, awaiting the main DeltaUSD TVL listing. A Yields pull request has not been submitted.

## Files

- `src/adaptors/deltausd/index.js`: proposed runtime adapter for dUSD on BNB Chain and X Layer.
- `scripts/deltausd.cjs`: deterministic checks, a live preview, and safe binding to the real DeFiLlama protocol id after listing.
- `PR_DRAFT.md`: prepared upstream pull request description.
- `deltausd-validation.json`: dated live validation evidence, not an adapter input.

Upstream base: `DefiLlama/yield-server` commit `c813f8bcf75d1b77285b6a5988c190578f941211` (12 November 2026). Existing dependencies and upstream files are unchanged. The adapter uses the existing `@defillama/sdk` and `axios` packages. It does not call the outgoing `yields.llama.fi` endpoints and does not need a Yields API key.

## Live contract bindings

| Deployment | SDK chain | DeFiLlama chain label | dUSD                                         | Redemption collateral                        | Collateral decimals |
| ---------- | --------- | --------------------- | -------------------------------------------- | -------------------------------------------- | ------------------- |
| BNB Chain  | `bsc`     | `Binance`             | `0x1851302297e318d658829fd94b89d5ae6528cb9e` | `0x55d398326f99059ff775485246999027b3197955` | 18                  |
| X Layer    | `xlayer`  | `X Layer`             | `0x450fb16f202bdbd4f3ebfc2a82f179dd8c1ce8d4` | `0x779ded0c9e1022225f8e0630b35a9b54be713736` | 6                   |

Each chain is read independently. These are separate local issuances with separate redemption liquidity, not two representations of a bridged supply. The adapter neither assumes matching rates nor copies BSC balances to X Layer. Only BNB Chain is marked as the canonical intrinsic yield source.

Public reference points:

- Website and redemption interface: https://deltausd.com/protocol
- Documentation: https://deltausd.com/documentation
- BSC contract: https://bscscan.com/address/0x1851302297e318d658829fd94b89d5ae6528cb9e#code
- X Layer contract: https://www.oklink.com/xlayer/address/0x450fb16f202bdbd4f3ebfc2a82f179dd8c1ce8d4
- Main TVL submission: https://github.com/DefiLlama/DefiLlama-Adapters/pull/22167
- Yields contribution requirements: https://github.com/DefiLlama/yield-server#how-to-list-a-new-protocol

## Current APR and the Yields APY field

The adapter reads the live `apr()`, `basePrice()`, `startTime()`, `getCurrentPrice()`, constants, supply, pause status and redemption wait from each deployed contract at a pinned block. It does not hardcode a rate or scrape the website. Setting a new APR requires no adapter edit.

The verified price formula uses integer arithmetic:

```text
P(t) = basePrice + floor(basePrice * apr * (t - startTime)
                         / (APR_DENOMINATOR * SECONDS_IN_YEAR))
configured APR (%) = 100 * apr / APR_DENOMINATOR
pricePerShare = P(t) / PRICE_SCALE              # USDT per dUSD, not USD
```

This is linear accrual, with no automatic compounding. `apr()/100` is the rate on the stored baseline; it can differ from the return on a new purchase at today's price. The proposed `apyBase` is the exact 365-day **holding** return at the current checkpoint:

```text
apyBase (%) = 100 * (P(t + SECONDS_IN_YEAR) - P(t)) / P(t)
```

This is a forward quote conditional on unchanged owner-controlled parameters, not measured strategy profit, a historical realized APY, or a guarantee. The adapter checks that its reconstructed current price and the one-token `quoteRedeem()` match the contract. Changed formulas, explicit redemption fees, units, or collateral bindings fail visibly instead of producing a fabricated zero or stale rate.

At the 12 November 2026 validation, `apr()` was `1100`, or **11% configured APR**, on both deployments. The 365-day holding return was approximately **10.9981%**. Neither value is embedded in the adapter. Historical 10.5% or 12% website examples are not used.

There is no separate explicit mint/redemption protocol fee in the reviewed deployment. An additional strategy-management fee is therefore not deducted again from the already configured holder price growth. Network gas is not estimated. DELETE incentives, referral rewards and unverified external strategy APRs are omitted.

### Redemption conditions

The current `holdPeriod()` is 604,800 seconds (7 days). `requestRedeem()` burns dUSD and fixes a USDT claim. That claim earns no more yield during the wait. `claim()` requires sufficient local contract USDT. The displayed holding return ends at the redemption request, rather than including that zero-accrual waiting period. A user's realized annualized cash return including the wait and gas can be lower.

The owner can change APR and other permitted parameters; BSC additionally permits resetting the price baseline. The formula does not prove reserve sufficiency or trading profit. The source does not impose a promised APY. These conditions are disclosed in `poolMeta` and this methodology for maintainer review. A pause sets `frozen: true` while retaining the existing pool.

## Yield-pool size versus the main backing TVL

For each local deployment:

```text
quoteRaw = floor(totalSupply * USDT_UNIT * currentPrice
                 / (DUSD_UNIT * PRICE_SCALE))
tvlUsd = quoteRaw / USDT_UNIT * marketPrice(USDT/USD)
```

This is the **contract-quoted value of locally outstanding dUSD claims**. It does not establish that this amount can currently be redeemed, and it is not a reserve-balance measurement. Pending claims are already burned out of totalSupply and are excluded from the yield pool because they no longer accrue. Their liquidity requirements still exist.

The separate TVL adapter in PR #22167 measures configured net on-chain backing positions, with disclosed exclusions. Its approximately $174k validation and the roughly $331k formula-valued dUSD claim supply are different metrics. They must not be made equal or added together. No external reserve wallet total, CEX short notional, GoMining valuation, or DeBank estimate is injected into Yields.

Only the collateral USD quote comes from DefiLlama's coins API. Missing, nonfinite, low-confidence or more-than-six-hour-old quotes cause an error. `pricePerShare` remains USDT/dUSD if USDT deviates from USD. Pools are returned separately even if one is too small for the website's display filters; X Layer held only about $2 of issued dUSD at validation.

Maintainers must approve both the owner-set rate methodology and this yield-pool valuation. Creating this repository does not make DeltaUSD appear in Yields.

## Run locally

Use the Node/npm versions in upstream `.nvmrc` and `src/adaptors/package.json`. From the repository root:

```sh
cd src/adaptors
npm install --ignore-scripts --package-lock=false
cd ../..
node scripts/deltausd.cjs test
node scripts/deltausd.cjs preview
```

For RPC overrides, the SDK accepts `BSC_RPC` and `XLAYER_RPC`. No private key, wallet connection, transaction, site login or DeFiLlama API key is needed.

The deterministic checks cover rate changes, baseline-relative yield, chain-specific collateral precision, paused and zero-rate pools, USDT depegs, bad prices, changed redemption quotes, malformed state, and separate local issuance. Live reads additionally verify both deployments against their pinned blocks.

Validation on 12 November 2026: all 10 deterministic checks passed, the official fast suite passed, and the full official suite passed 25 checks. Its three failures are the expected registration prerequisites: the unpublished `deltausd` slug, its unavailable real id, and the deliberately unset numeric string-literal id. The full suite has **not** passed; the adapter is not yet ready for an upstream Yields submission.

## Finalize after the TVL listing

The production export is deliberately `protocolId: null` while no matching TVL listing exists. No fake numeric id or another project's id is used. Upstream's full tests must reject an unpublished protocol.

1. Confirm the DeltaUSD TVL listing is published under slug `deltausd` in https://api.llama.fi/protocols.
2. Run `node scripts/deltausd.cjs finalize`. It checks the exact slug and BSC dUSD token before writing the real numeric **string literal** required by yield-server-v2. An absent, ambiguous or wrong-token listing changes no file.
3. Re-run `node scripts/deltausd.cjs test` and `node scripts/deltausd.cjs preview`.
4. Run the full official suite:

   ```sh
   cd src/adaptors
   npm run test --adapter=deltausd
   ```

5. Commit the real id, review the resulting data, and submit the prepared Yields PR. The minimal upstream change is `src/adaptors/deltausd/index.js`; preparation documents, snapshots and local scripts can stay in this fork.

If DeFiLlama assigns a different slug or metadata format, review that registration rather than guessing an id or silently binding to another token. No future PR or automatic scheduled action has been created.
