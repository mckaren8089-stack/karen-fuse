(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.KarenCalc=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function finitePositive(v){
    const n=Number(v);
    return Number.isFinite(n) && n>0 ? n : null;
  }

  function feeRate(feePct){
    const n=Number(feePct);
    if(!Number.isFinite(n) || n<0 || n>100) return null;
    return n/100;
  }

  function calculate({direction,inputType,inputValue,price,feePct}){
    const side=direction==='sell'?'sell':'buy';
    const mode=inputType==='gold'?'gold':'toman';
    const value=finitePositive(inputValue);
    const p=finitePositive(price);
    const fee=feeRate(feePct);
    if(!value || !p || fee===null || (side==='sell' && fee>=1)) return null;

    if(side==='buy' && mode==='toman'){
      const totalToman=value;
      const commodityToman=totalToman/(1+fee);
      const feeAmount=totalToman-commodityToman;
      const finalGold=commodityToman/p;
      return {
        direction:side,inputType:mode,referencePrice:p,inputValue:value,
        grossResult:value/p, grossResultUnit:'gold',
        feePct:fee*100, feeAmount,
        finalResult:finalGold, finalResultUnit:'gold',
        commodityToman,totalToman
      };
    }

    if(side==='buy' && mode==='gold'){
      const gold=value;
      const grossToman=gold*p;
      const feeAmount=grossToman*fee;
      const totalToman=grossToman+feeAmount;
      return {
        direction:side,inputType:mode,referencePrice:p,inputValue:value,
        grossResult:grossToman, grossResultUnit:'toman',
        feePct:fee*100, feeAmount,
        finalResult:totalToman, finalResultUnit:'toman',
        commodityToman:grossToman,totalToman,gold
      };
    }

    if(side==='sell' && mode==='gold'){
      const gold=value;
      const grossToman=gold*p;
      const feeAmount=grossToman*fee;
      const netToman=grossToman-feeAmount;
      return {
        direction:side,inputType:mode,referencePrice:p,inputValue:value,
        grossResult:grossToman, grossResultUnit:'toman',
        feePct:fee*100, feeAmount,
        finalResult:netToman, finalResultUnit:'toman',
        grossToman,netToman,gold
      };
    }

    const targetNetToman=value;
    const grossToman=targetNetToman/(1-fee);
    const feeAmount=grossToman-targetNetToman;
    const gold=grossToman/p;
    return {
      direction:side,inputType:mode,referencePrice:p,inputValue:value,
      grossResult:gold, grossResultUnit:'gold',
      feePct:fee*100, feeAmount,
      finalResult:gold, finalResultUnit:'gold',
      grossToman,targetNetToman,gold
    };
  }

  return {calculate};
});
