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

  function calibrationParts(raw){
    const ref=finitePositive(raw?.reference_gold18 ?? raw?.ref);
    const buy=finitePositive(raw?.blu_buy_quote ?? raw?.buy);
    const sell=finitePositive(raw?.blu_sell_quote ?? raw?.sell);
    const t=raw?.timestamp ?? raw?.at;
    const at=typeof t==='number'?t:new Date(t||0).getTime();
    if(!ref || !buy || !sell || !Number.isFinite(at) || at<=0) return null;
    return {ref,buy,sell,at};
  }

  function bluBasis(calibrations,{windowHours=72,maxSamples=8,maxDeltaPct=2.5}={}){
    const rows=(Array.isArray(calibrations)?calibrations:[])
      .map(calibrationParts).filter(Boolean).sort((a,b)=>a.at-b.at);
    if(!rows.length) return {buy:0,sell:0,count:0,latestAt:null};

    const latest=rows[rows.length-1];
    const cutoff=latest.at-windowHours*3600e3;
    const lb=(latest.buy/latest.ref-1)*100;
    const ls=(latest.sell/latest.ref-1)*100;
    const candidates=rows
      .filter(r=>r.at>=cutoff)
      .slice(-maxSamples)
      .filter(r=>{
        const b=(r.buy/r.ref-1)*100, s=(r.sell/r.ref-1)*100;
        return Math.abs(b-lb)<=maxDeltaPct && Math.abs(s-ls)<=maxDeltaPct;
      });

    let buySum=0,sellSum=0,weightSum=0;
    candidates.forEach(r=>{
      const ageHours=Math.max(0,(latest.at-r.at)/3600e3);
      let w=Math.exp(-ageHours/12);
      if(r===latest) w*=4;
      buySum+=(r.buy/r.ref-1)*100*w;
      sellSum+=(r.sell/r.ref-1)*100*w;
      weightSum+=w;
    });
    if(!weightSum) return {buy:lb,sell:ls,count:1,latestAt:latest.at};
    return {buy:buySum/weightSum,sell:sellSum/weightSum,count:candidates.length,latestAt:latest.at};
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

  return {calculate,bluBasis};
});
