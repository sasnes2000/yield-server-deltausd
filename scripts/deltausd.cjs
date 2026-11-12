// Local preparation tools. Not part of the adapter's runtime.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const file = path.resolve(__dirname, '../src/adaptors/deltausd/index.js');
const source = () => fs.readFileSync(file, 'utf8');

function fixture(overrides = {}) {
  return {
    apr: '1100',
    basePrice: '1000000000000000000',
    startTime: '1700000000',
    getCurrentPrice: '1000000000000000000',
    totalSupply: '20000000000000000000000',
    holdPeriod: '604800',
    APR_DENOMINATOR: '10000',
    SECONDS_IN_YEAR: '31536000',
    PRICE_SCALE: '1000000000000000000',
    DUSD_UNIT: '1000000000000000000',
    USDT_UNIT: '1000000000000000000',
    timestamp: 1700000000,
    paused: false,
    redeemQuote: '1000000000000000000',
    ...overrides,
  };
}

function isolated(fixtures, priceOverrides = {}) {
  const calls = [];
  const tokens = {
    bsc: '0x55d398326f99059ff775485246999027b3197955',
    xlayer: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
  };
  const mockSdk = {
    ChainApi: class {
      constructor({ chain }) {
        this.chain = chain;
        this.s = fixtures[chain];
        this.provider = {
          getBlock: async (block) => {
            assert.equal(block, 1234);
            return { timestamp: this.s.timestamp };
          },
        };
      }
      async getBlock() {
        this.block = 1234;
        return 1234;
      }
      async call({ target, abi, params }) {
        assert.equal(this.block, 1234, 'reads must be pinned before executing');
        calls.push({ chain: this.chain, target, abi, params });
        if (abi === 'address:usdt')
          return this.s.collateral || tokens[this.chain];
        if (abi === 'erc20:decimals')
          return target === tokens[this.chain] && this.chain === 'xlayer'
            ? '6'
            : '18';
        if (abi.includes('quoteRedeem')) return this.s.redeemQuote;
        const name = abi.split(':')[1];
        if (!(name in this.s)) throw new Error(`Unexpected read: ${abi}`);
        return this.s[name];
      }
    },
  };
  const prices = Object.fromEntries(
    Object.entries(tokens).map(([chain, token]) => [
      `${chain}:${token}`,
      { price: 1, timestamp: Math.floor(Date.now() / 1000), confidence: 1 },
    ])
  );
  for (const [key, value] of Object.entries(priceOverrides))
    prices[key] = value;
  const context = {
    module: { exports: {} },
    console,
    Date,
    require: (name) => {
      if (name === '@defillama/sdk') return mockSdk;
      if (name === 'axios')
        return { get: async () => ({ data: { coins: prices } }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source(), context, { filename: file });
  return { adapter: context.module.exports, calls };
}

function xlayer(s = {}) {
  return fixture({ USDT_UNIT: '1000000', redeemQuote: '1000000', ...s });
}

async function test() {
  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  };
  await check(
    '11% at a fresh baseline; separate BSC and X Layer supply/units',
    async () => {
      const { adapter, calls } = isolated({
        bsc: fixture(),
        xlayer: xlayer({ totalSupply: '2000000000000000000' }),
      });
      const pools = await adapter.apy();
      assert.equal(pools.length, 2);
      assert.equal(pools[0].apyBase, 11);
      assert.equal(pools[0].tvlUsd, 20000);
      assert.equal(pools[1].tvlUsd, 2);
      assert.equal(pools[0].pricePerShare, 1);
      assert.equal(pools[0].isIntrinsicSource, true);
      assert.equal(pools[1].isIntrinsicSource, false);
      assert.equal(pools[0].chain, 'Binance');
      assert.equal(pools[1].chain, 'X Layer');
      assert.match(
        pools[0].poolMeta,
        /APR 11%.*7d redemption wait with no accrual/
      );
      assert.equal(new Set(pools.map((p) => p.pool)).size, 2);
      assert.ok(calls.length > 0);
    }
  );
  await check(
    'seasoned linear baseline gives about 9.91%, not the nominal 11%',
    async () => {
      const mature = {
        timestamp: 1731536000,
        getCurrentPrice: '1110000000000000000',
      };
      const { adapter } = isolated({
        bsc: fixture({ ...mature, redeemQuote: mature.getCurrentPrice }),
        xlayer: xlayer({ ...mature, redeemQuote: '1110000' }),
      });
      const [pool] = await adapter.apy();
      assert.ok(Math.abs(pool.apyBase - 11 / 1.11) < 1e-12);
      assert.ok(Math.abs(pool.tvlUsd - 22200) < 1e-8);
      assert.equal(pool.pricePerShare, 1.11);
    }
  );
  await check(
    'changed APR is reflected without editing the adapter',
    async () => {
      const { adapter } = isolated({
        bsc: fixture({ apr: '800' }),
        xlayer: xlayer({ apr: '800' }),
      });
      const pools = await adapter.apy();
      assert.equal(pools[0].apyBase, 8);
      assert.match(pools[0].poolMeta, /APR 8%/);
    }
  );
  await check('zero APR and paused pools remain present', async () => {
    const { adapter } = isolated({
      bsc: fixture({ apr: '0', paused: true }),
      xlayer: xlayer({ apr: '0' }),
    });
    const pools = await adapter.apy();
    assert.equal(pools[0].apyBase, 0);
    assert.equal(pools[0].frozen, true);
    assert.equal(pools.length, 2);
  });
  await check(
    'USDT depeg changes TVL, not USDT/share or the holding yield',
    async () => {
      const key = 'bsc:0x55d398326f99059ff775485246999027b3197955';
      const { adapter } = isolated(
        { bsc: fixture(), xlayer: xlayer() },
        {
          [key]: {
            price: 0.98,
            timestamp: Math.floor(Date.now() / 1000),
            confidence: 1,
          },
        }
      );
      const [pool] = await adapter.apy();
      assert.equal(pool.tvlUsd, 19600);
      assert.equal(pool.pricePerShare, 1);
      assert.equal(pool.apyBase, 11);
    }
  );
  await check('reject changed redemption fees/formula', async () => {
    const { adapter } = isolated({
      bsc: fixture({ redeemQuote: '990000000000000000' }),
      xlayer: xlayer(),
    });
    await assert.rejects(adapter.apy(), /redemption quote changed/);
  });
  await check(
    'reject a future checkpoint or inconsistent contract price',
    async () => {
      for (const override of [
        { startTime: '1700000001' },
        { getCurrentPrice: '1010000000000000000' },
      ]) {
        const { adapter } = isolated({
          bsc: fixture(override),
          xlayer: xlayer(),
        });
        await assert.rejects(adapter.apy(), /checkpoint|formula/);
      }
    }
  );
  await check(
    'reject stale, missing, nonfinite or low-confidence prices',
    async () => {
      const key = 'bsc:0x55d398326f99059ff775485246999027b3197955';
      for (const quote of [
        undefined,
        { price: 1, timestamp: 1 },
        { price: NaN, timestamp: Date.now() / 1000 },
        { price: 1, timestamp: Date.now() / 1000, confidence: 0.1 },
        { price: 1, timestamp: Date.now() / 1000, confidence: NaN },
      ]) {
        const { adapter } = isolated(
          { bsc: fixture(), xlayer: xlayer() },
          { [key]: quote }
        );
        await assert.rejects(adapter.apy(), /collateral USD price/);
      }
    }
  );
  await check(
    'reject a changed collateral deployment and malformed integer',
    async () => {
      for (const override of [
        { collateral: '0x0000000000000000000000000000000000000001' },
        { apr: '-1' },
      ]) {
        const { adapter } = isolated({
          bsc: fixture(override),
          xlayer: xlayer(),
        });
        await assert.rejects(adapter.apy(), /deployment|Invalid apr/);
      }
    }
  );
  await check(
    'local chain issuance is never added to reserve-wallet TVL or duplicated',
    async () => {
      const { adapter } = isolated({
        bsc: fixture(),
        xlayer: xlayer({ totalSupply: '0' }),
      });
      const pools = await adapter.apy();
      assert.equal(pools[0].tvlUsd, 20000);
      assert.equal(pools[1].tvlUsd, 0);
      assert.equal('apyReward' in pools[0], false);
    }
  );
  console.log(`\n${passed} meaningful checks passed.`);
}

async function finalize() {
  const axios = require('axios');
  const { data } = await axios.get('https://api.llama.fi/protocols', {
    timeout: 20000,
  });
  const matches = data.filter((p) => p.slug === 'deltausd');
  if (matches.length !== 1 || !/^\d+$/.test(String(matches[0].id))) {
    throw new Error(
      'DeltaUSD has no unique real TVL listing yet. No file was changed.'
    );
  }
  const p = matches[0];
  const expectedBsc = '0x1851302297e318d658829fd94b89d5ae6528cb9e';
  if (p.address?.replace(/^bsc:/, '').toLowerCase() !== expectedBsc) {
    throw new Error(
      'The deltausd listing token does not match the configured BSC deployment. Review metadata before proceeding.'
    );
  }
  const before = source();
  const pattern = /protocolId:\s*(?:null|'\d+')/g;
  if ([...before.matchAll(pattern)].length !== 1)
    throw new Error('Unexpected protocolId assignment; no file changed.');
  fs.writeFileSync(file, before.replace(pattern, `protocolId: '${p.id}'`));
  console.log(
    `Bound deltausd to its real protocolId ${p.id}. Run the official full test before submitting.`
  );
}

async function preview() {
  const pools = await require(file).apy();
  console.log(
    JSON.stringify({ observedAt: new Date().toISOString(), pools }, null, 2)
  );
}

const commands = { test, preview, finalize };
const command = process.argv[2] || 'test';
if (!commands[command]) {
  console.error('Usage: node scripts/deltausd.cjs [test|preview|finalize]');
  process.exitCode = 1;
} else {
  commands[command]().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
