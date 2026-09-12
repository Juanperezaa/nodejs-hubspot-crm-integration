'use strict';

/**
 * Section 1.3 — Modules and CommonJS (the importing half).
 *
 * Brief: "main.js imports and uses it."
 *
 * Demonstrates the consuming side of the CommonJS contract: `require` resolves
 * and evaluates the module once, caches the resulting exports object, and
 * returns that same object to every subsequent caller in the process. The last
 * section below proves the caching behaviour rather than asserting it.
 *
 * Run directly: `npm run fundamentals:modules`
 */

// Destructuring at the point of import keeps the dependency explicit: a reader
// sees which three functions this file actually uses without searching the body.
const { sumArrayOfNumbers, averageArrayOfNumbers, sumDealAmounts } = require('./utils_module');

/** Deal-shaped fixtures, matching what the HubSpot API returns: amounts as strings. */
const SAMPLE_DEALS = Object.freeze([
  { properties: { dealname: 'Enterprise licence', amount: '15000.00' } },
  { properties: { dealname: 'Onboarding package', amount: '2500.50' } },
  { properties: { dealname: 'Unvalued opportunity', amount: null } },
  { properties: { dealname: 'Support retainer', amount: '899.99' } },
]);

/**
 * Exercises the imported module and reports the results.
 *
 * @returns {void}
 */
function demonstrateModuleUsage() {
  process.stdout.write('\nSection 1.3 — Modules and CommonJS\n');
  process.stdout.write('='.repeat(66) + '\n\n');

  // --- 1. The required function ---------------------------------------------
  const quantities = [12, 7, 30, 1, 50];
  process.stdout.write('1. sumArrayOfNumbers\n');
  process.stdout.write(`   input : [${quantities.join(', ')}]\n`);
  process.stdout.write(`   sum   : ${sumArrayOfNumbers(quantities)}\n`);
  process.stdout.write(`   mean  : ${averageArrayOfNumbers(quantities)}\n`);
  process.stdout.write(`   empty : ${sumArrayOfNumbers([])}\n\n`);

  // --- 2. Input validation --------------------------------------------------
  process.stdout.write('2. Rejecting input that would coerce silently\n');
  try {
    sumArrayOfNumbers([1, 2, '3']);
  } catch (error) {
    process.stdout.write(`   caught: ${error.message}\n`);
    process.stdout.write("   without this check the result would be the string '33'\n\n");
  }

  try {
    sumArrayOfNumbers([1, NaN, 3]);
  } catch (error) {
    process.stdout.write(`   caught: ${error.message}\n`);
    process.stdout.write('   NaN propagates through addition and poisons every total\n\n');
  }

  // --- 3. Applied to the project's domain -----------------------------------
  process.stdout.write('3. sumDealAmounts, applied to HubSpot-shaped records\n');
  for (const deal of SAMPLE_DEALS) {
    const displayAmount = deal.properties.amount ?? '(not set)';
    process.stdout.write(`   ${deal.properties.dealname.padEnd(24)} ${displayAmount}\n`);
  }
  process.stdout.write(`   total: ${sumDealAmounts(SAMPLE_DEALS).toFixed(2)}\n`);
  process.stdout.write('   note: HubSpot returns amounts as strings, so a naive\n');
  process.stdout.write('         sum would concatenate rather than add\n\n');

  // --- 4. Module caching, demonstrated rather than claimed -------------------
  process.stdout.write('4. CommonJS module caching\n');
  const firstImport = require('./utils_module');
  const secondImport = require('./utils_module');
  process.stdout.write(
    `   require() returns the same object both times: ${firstImport === secondImport}\n`
  );
  process.stdout.write('   the module body is evaluated once per process, then cached\n\n');
}

if (require.main === module) {
  demonstrateModuleUsage();
}

module.exports = { demonstrateModuleUsage, SAMPLE_DEALS };
