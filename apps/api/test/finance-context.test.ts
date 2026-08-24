import assert from 'node:assert/strict';import test from 'node:test';
import { calculateBudget,decimalToMinor,minorToDecimal } from '../src/domain/finance-context.js';
test('calculates available and projected amounts with integer precision',()=>{const result=calculateBudget(12000000n,2000000n,500000n,1000n);assert.equal(result.available,9500000n);assert.equal(result.projectedAvailable,9499000n)});
test('preserves decimal precision and zero/negative display semantics',()=>{assert.equal(decimalToMinor('10.20'),1020n);assert.equal(decimalToMinor('0.00'),0n);assert.equal(minorToDecimal(-1n),'-0.01');assert.throws(()=>decimalToMinor('1.001'))});
test('never uses floating point or mixes invalid monetary inputs',()=>{assert.equal(calculateBudget(0n,0n,0n,0n).available,0n);assert.throws(()=>calculateBudget(1n,-1n,0n,0n))});
