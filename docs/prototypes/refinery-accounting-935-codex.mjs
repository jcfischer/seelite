// Decision instrument, not production code. Refs #935. Author: Codex.
import assert from 'node:assert/strict';
const Q = 1n << 1074n;
const M = (1n << 2156n) * 15625n;
const MONEY_MAX = (1n << 3200n) - 1n;
const MASS_MAX = (1n << 2176n) - 1n;
let checks = 0;
const eq = (a,b) => { assert.equal(a,b); checks++; };
function binaryTicks(x) {
  assert(Number.isFinite(x));
  const a = new DataView(new ArrayBuffer(8)); a.setFloat64(0,x);
  const bits = a.getBigUint64(0), exp = Number((bits >> 52n) & 2047n);
  const mantissa = bits & ((1n<<52n)-1n);
  const n = exp === 0 ? mantissa : ((1n<<52n)|mantissa) << BigInt(exp-1);
  return bits >> 63n ? -n : n;
}
const money = x => binaryTicks(x) * (M/Q);
const mass = x => binaryTicks(x);
function encode(n) {
  if(n === 0n) return '0';
  const sign=n<0n?'-':''; if(n<0n)n=-n;
  let shift=0; while((n&1n)===0n){n>>=1n;shift++;}
  return `${sign}${n.toString(16)}@${shift}`;
}
function decode(s, bits=3200) {
  assert(typeof s==='string' && s.length<=Math.ceil(bits/4)+6);
  if(s==='0')return 0n;
  assert(/^-?[1-9a-f][0-9a-f]*@(0|[1-9][0-9]{0,3})$/.test(s));
  const original=s;
  const neg=s.startsWith('-'); if(neg)s=s.slice(1);
  const [c,e]=s.split('@'); assert(Number(e)<bits);
  const coefficient=BigInt(`0x${c}`);
  assert(coefficient.toString(2).length+Number(e)<=bits);
  const value=coefficient*(neg?-1n:1n)<<BigInt(e);
  eq(encode(value),original); return value;
}
function checked(n,max) { if(n<0n||n>max)throw Error('out of range'); return n; }
function validate(s) {
  checked(s.total,MASS_MAX); checked(s.unknown,s.total);
  checked(s.debt,MONEY_MAX); checked(s.bank,MONEY_MAX);
  checked(s.cash<0n?-s.cash:s.cash,MONEY_MAX); return s;
}
function sale(s, quantity, unitGrams, quote) {
  validate(s);checked(quantity,MASS_MAX);checked(quote,MONEY_MAX);
  const removed=quantity*BigInt(unitGrams);
  assert(removed<=s.total);
  const unknown=removed<s.unknown?removed:s.unknown;
  const eligible=removed-unknown;
  const divisor=Q*BigInt(unitGrams);
  // Quote is an exact lift of a finite binary64 native-unit price.
  eq((quote*eligible)%divisor,0n);
  eq((quote*removed)%divisor,0n);
  const proceeds=quote*removed/divisor, recoverable=quote*eligible/divisor;
  const recovered=recoverable<s.debt?recoverable:s.debt;
  return validate({total:s.total-removed, unknown:s.unknown-unknown,
    debt:s.debt-recovered, bank:s.bank+recoverable-recovered,cash:s.cash+proceeds});
}
const initial=(total,unknown,cost)=>validate({total,unknown,debt:cost,bank:money(100),cash:money(1000)});
function remove(s, grams) {
  validate(s);checked(grams,s.total);
  const unknown=grams<s.unknown?grams:s.unknown;
  return {state:validate({...s,total:s.total-grams,unknown:s.unknown-unknown}),lost:{grams,unknown}};
}
function recover(s, lost) {
  checked(lost.unknown,lost.grams);
  return validate({...s,total:s.total+lost.grams,unknown:s.unknown+lost.unknown});
}
const yields=[200000,400000,800000,500,1000,2000,250,500,1000,5,10,20,1000000,1000,1];
// Legacy endpoints and common fractional values lift with no rounding.
for(const x of [0,Number.MIN_VALUE,Number.MAX_VALUE,0.1,1/3,2**53,1000,-0.1]) {
  const n=money(x); eq(decode(encode(n)),n);
  assert(n<=MONEY_MAX && n>=-MONEY_MAX); checks++;
  const g=mass(x)*1000000n; eq(decode(encode(g)),g);
  assert(g<=MASS_MAX && g>=-MASS_MAX); checks++;
}
// Exact per-unit stream: grouped versus every two-way split, including an
// unknown/eligible boundary inside a native unit and the smallest legacy dust.
for(const unit of yields) for(const price of [0.1,0.4,1,17.3,Number.MIN_VALUE])
for(let n=1;n<=20;n++) for(const unknown of [0n,Q/4n*BigInt(unit),Q*BigInt(unit),
  (BigInt(n)*Q-1n)*BigInt(unit),1n,Q-1n,
  (250n*Q < BigInt(n*unit)*Q ? 250n*Q : 0n)]) {
  const start=initial(BigInt(n)*Q*BigInt(unit),unknown,money(2));
  const whole=sale(start,BigInt(n)*Q,unit,money(price));
  for(let k=0;k<=n;k++) {
    const split=sale(sale(start,BigInt(k)*Q,unit,money(price)),BigInt(n-k)*Q,unit,money(price));
    assert.deepEqual(split,whole);checks++;
  }
}
// Original reproduction and persistent loss carry.
let s=initial(2n*Q*1000000n,0n,money(40));
s=sale(s,Q,1000000,money(20));eq(s.bank,money(100));
s=sale(s,Q,1000000,money(20));eq(s.bank,money(100));eq(s.debt,0n);
s=initial(2n*Q*1000000n,0n,money(40));
s=sale(s,2n*Q,1000000,money(15));eq(s.debt,money(10));
s={...s,total:Q*1000000n,debt:s.debt+money(20)};
s=sale(s,Q,1000000,money(35));eq(s.bank,money(105));
// Collection has no progression transition. Physical cost allocation may
// differ below one quantum per division, but never creates or loses cost.
for(let q=1n;q<=100n;q++)for(let k=0n;k<=q;k++)for(const c of [1n,17n,money(.1),MONEY_MAX]) {
  const moved=c*k/q, left=c-moved;
  eq(moved+left,c);assert(c*k-moved*q<q);checks++;
  if(k===q)eq(left,0n);
}
// Exact wallet remains additive where Number loses the payment.
eq(money(2**53)+money(1)+money(1),money(2**53)+money(2));
eq(money(1000)+3n*money(.1),money(1000)+money(.1)+money(.1)+money(.1));
for(const [value,max] of [[MONEY_MAX,MONEY_MAX],[MASS_MAX,MASS_MAX]]) {
  eq(checked(value,max),value);assert.throws(()=>checked(value+1n,max));checks++;
}
const before=initial(Q,0n,0n);before.cash=MONEY_MAX;
const snapshot={...before};assert.throws(()=>sale(before,Q,1,money(1)));
assert.deepEqual(before,snapshot);checks+=2;
for(const malformed of ['1@999999999','1@3200','01@0','2@0','1@0@0','f'.repeat(900)+'@0']) {
  assert.throws(()=>decode(malformed));checks++;
}
for(let total=1n;total<=40n;total++)for(let unknown=0n;unknown<=total;unknown++)
for(let amount=0n;amount<=total;amount++) {
  const start=initial(total,unknown,money(19));
  const lost=remove(start,amount);
  eq(lost.state.debt,start.debt);eq(lost.state.bank,start.bank);
  assert.deepEqual(recover(lost.state,lost.lost),start);checks++;
  // Partial recovery consumes unknown first from the loss record, not
  // from current owned stock, and retains the exact remainder.
  const first=amount/2n;
  const firstUnknown=first<lost.lost.unknown?first:lost.lost.unknown;
  const partial=recover(lost.state,{grams:first,unknown:firstUnknown});
  assert.deepEqual(recover(partial,{grams:amount-first,unknown:lost.lost.unknown-firstUnknown}),start);checks++;
}
// Refining unknown stock adds its known fee, while selling it adds no
// recoverable proceeds. Later eligible sales must cover that fee (D15).
let legacy=initial(Q,Q,0n);legacy={...legacy,debt:money(7),cash:legacy.cash-money(7)};
legacy=sale(legacy,Q,1,money(20));eq(legacy.debt,money(7));eq(legacy.bank,money(100));
// Candidate numeric payload only: deliberately widest bounded encodings.
// This is not the whole save or a browser-storage benchmark.
const amount=encode(MONEY_MAX), grams=encode(MASS_MAX);
const custody={grams,cost:amount};
const job={id:'ffffffffffffffff',recipe:14,remainingWork:'ffffffffffffffff',...custody};
const refinery={jobs:Array.from({length:8},()=>job),products:Array.from({length:5},()=>custody)};
const payload={refineries:Array.from({length:2048},(_,i)=>({galaxy:i>>8,system:i%256,...refinery})),
  pools:Array.from({length:17},()=>({total:grams,unknown:grams,debt:amount})),cash:amount,bankedTrade:amount};
const bytes=Buffer.byteLength(JSON.stringify(payload));
const ordinaryText=JSON.stringify(payload).replaceAll(amount,encode(money(100))).replaceAll(grams,encode(mass(1000000)));
console.log(JSON.stringify({checks,moneyQuantum:'1/(2^2156*5^6) Cr',massQuantum:'2^-1074 g',
  moneyBits:3200,massBits:2176,maxMoneyEncoding:amount.length,maxMassEncoding:grams.length,
  candidateAccountingPayloadBytes:bytes,sameRowCountOrdinaryAmountsBytes:Buffer.byteLength(ordinaryText),
  limitations:'Candidate numeric payload, not complete envelope; no IndexedDB timing or production verification.'},null,2));
