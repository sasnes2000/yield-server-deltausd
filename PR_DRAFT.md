# Add DeltaUSD dUSD holding-yield adapter

Preparation only: publish after the TVL registration exists and the exact `protocolId` has been bound and all official tests pass.

## Protocol

- Name: DeltaUSD
- Expected slug: `deltausd` (must match the final TVL registration)
- Website: https://deltausd.com/protocol
- Main TVL submission: https://github.com/DefiLlama/DefiLlama-Adapters/pull/22167
- Networks: BNB Chain (`Binance`) and X Layer (`X Layer`)
- BSC dUSD: `0x1851302297e318d658829fd94b89d5ae6528cb9e`
- X Layer dUSD: `0x450fb16f202bdbd4f3ebfc2a82f179dd8c1ce8d4`

## Resulting behavior

Adds separate dUSD pools for each local issuance. Each run reads the APR, price checkpoint, redemption quote, supply, pause state, units and redemption wait from the contracts at a pinned block. The USDT/USD quote uses the coins API. There is no fixed website APR, external reserve total, reward token APY or added dependency.

`apyBase` is the contract formula's 365-day holding return from the current dUSD price, conditional on unchanged owner-controlled parameters. The contract grows linearly, so the adapter does not invent compounding or equate the nominal baseline APR with the return on a new purchase. `poolMeta` reports the current configured APR and non-accruing redemption wait. `pricePerShare` is USDT per dUSD; only BNB Chain is marked as the canonical intrinsic source.

## Methodology requiring review

- The configured APR is owner-set, not independently verified strategy profit. BSC permits an owner baseline reset; X Layer pricing is separately synchronized by the owner.
- The current 7-day redemption wait starts when dUSD is burned and its USDT claim is fixed. No yield accrues during this wait. Holding APY excludes this wait and network gas; a realized cash-return calculation including them can be lower.
- Claims require enough USDT in the local contract. Calculated price growth does not create redemption liquidity or prove backing.
- Yield-pool `tvlUsd` values each chain's outstanding dUSD supply at its local contract redemption quote, translated using USDT/USD. This is a claim-value metric, not the separate partial on-chain backing TVL in #22167. Pending burned claims no longer accrue and are omitted from the yield pool. We are requesting maintainer review of this valuation and rate methodology, not presenting formula-valued liabilities as verified reserves.
- No extra strategy-management fee is deducted from holder quote growth; the reviewed contract has no additional explicit mint/redeem fee. Referrals and DELETE incentives are excluded.
- X Layer currently has a very small issued supply; both pools are returned and platform display filters may hide the small pool.

## Validation

The fork contains deterministic checks and a dated live two-network snapshot. Before submitting, bind the real numeric string-literal `protocolId` using `node scripts/deltausd.cjs finalize`, repeat the live preview, and run `npm run test --adapter=deltausd` from `src/adaptors`. Do not submit with `protocolId: null` or claim the full registration checks passed while DeltaUSD is absent from the protocols API.

The upstream PR can contain only `src/adaptors/deltausd/index.js`; fork preparation tools and evidence need not be included.
