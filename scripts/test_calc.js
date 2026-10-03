const assert=require('assert');
const {calculate}=require('../calc.js');

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
