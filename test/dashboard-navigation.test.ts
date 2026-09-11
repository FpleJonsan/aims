import assert from 'node:assert/strict';
import test from 'node:test';
import {dashboardDestination,financePath,navigationFilters} from '../app/lib/dashboard-navigation.ts';
import {routeForSession} from '../app/lib/session-ux.ts';
test('cards resolve to existing operational screens',()=>{
 assert.equal(dashboardDestination('REPORTING_REQUESTS','PENDING_APPROVAL'),'approvals');
 assert.equal(dashboardDestination('FINANCE_CONTROL'),'finance-control');
 assert.equal(dashboardDestination('PAYMENT_QUEUE'),'payment-queue');
 assert.equal(dashboardDestination('PAYMENT_HISTORY'),'payment-history');
});
test('queue URLs preserve only supported scope, without a new HOLD filter',()=>{
 const path=financePath('finance-control',{departmentId:'department',category:'Travel & Meals',status:'HOLD',dateFrom:'2026-01-01'});
 assert.equal(path,'/finance/finance-control?departmentId=department&category=Travel+%26+Meals');
 assert.deepEqual(navigationFilters('finance-control',path.split('?')[1]),{departmentId:'department',category:'Travel & Meals'});
 assert.equal(financePath('approvals',{category:'Travel'}),'/finance/approvals');
});
test('authorized refresh preserves deep link and unauthorized navigation falls back',()=>{
 const session={workspaces:{requester:true,finance:true},capabilities:{financeAnalysis:false,approval:false,financeControl:true,payment:false,reporting:false,policyAdmin:false}};
 const path=financePath('finance-control',{category:'Travel'});
 assert.equal(routeForSession(session,path,null).path,path);
 assert.equal(routeForSession(session,'/finance/payment-queue?category=Travel',null).path,'/finance/finance-control');
});
test('dashboard return context and payment history filters round trip',()=>{
 const filters={dateFrom:'2026-01-01',dateTo:'2026-12-31',category:'Travel',departmentId:'department'};
 const path=financePath('dashboard',filters);
 assert.deepEqual(navigationFilters('dashboard',path.split('?')[1]),filters);
 assert.equal(navigationFilters('payment-history','status=PAID&search=Vendor').status,'PAID');
});
