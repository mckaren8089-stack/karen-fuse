const assert=require('assert');
const {calculate,bluBasis}=require('../calc.js');

function close(a,b,tol=1e-8){ assert(Math.abs(a-b)<=tol, String(a)+' != '+String(b)); }

const p=25_000_000;

const buyBudget=calculate({direction:'buy',inputType:'toman',inputValue:50_000_000,price:p,feePct:0.5});
close(buyBudget.finalResult,50_000_000/(p*1.005));
close(buyBudget.feeAmount,50_000_000-(50_000_000/1.005),1e-6);

const buyGold=calculate({direction:'buy',inputType:'gold',inputValue:3,price:p,feePct:0.5});
close(buyGold.finalResult,75_375_000);
close(buyGold.feeAmount,375_000);

const sellGold=calculate({direction:'sell',inputType:'gold',inputValue:3,price:p,feePct:0.5});
close(sellGold.finalResult,74_625_000);
close(sellGold.feeAmount,375_000);

const sellTarget=calculate({direction:'sell',inputType:'toman',inputValue:50_000_000,price:p,feePct:0.5});
close(sellTarget.finalResult,(50_000_000/0.995)/p);

assert.strictEqual(calculate({direction:'buy',inputType:'gold',inputValue:0,price:p,feePct:0.5}),null);
console.log('calculator-test: ok');


const now=Date.parse('2026-10-03T18:00:00Z');
const basis=bluBasis([
  {timestamp:new Date(now-48*3600e3).toISOString(),reference_gold18:25_000_000,blu_buy_quote:23_000_000,blu_sell_quote:23_000_000},
  {timestamp:new Date(now-2*3600e3).toISOString(),reference_gold18:26_000_000,blu_buy_quote:26_078_000,blu_sell_quote:26_052_000},
  {timestamp:new Date(now).toISOString(),reference_gold18:26_200_000,blu_buy_quote:26_331_000,blu_sell_quote:26_305_000}
]);
assert(basis.count>=1);
assert(basis.latestAt===now);
assert(basis.buy>0 && basis.buy<1, 'latest positive Blu basis must not be poisoned by old negative outlier');
assert(basis.sell>0 && basis.sell<1, 'latest sell basis must stay near recent observations');
console.log('blu-basis-test: ok');
