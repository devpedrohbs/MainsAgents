export interface ProductionBudgetLimits {maxCalls:number;maxAttemptsPerStep:number}
export type UsageStatus='reported'|'partial'|'unavailable';
export type UsageReason='no-result'|'cancelled'|'not-reported'|'zeroed-error'|'error-result'|'provider-no-usage'|'timeout';
export interface UsageTokens {input?:number;output?:number;cacheRead?:number;cacheCreation?:number}
export interface UsageModel extends UsageTokens {model:string;reportedCostUsd?:number}
/** Reported by the provider CLI. Absent fields are unavailable, never 0. `reportedCostUsd` is the CLI's own estimate, not a bill or balance. */
export interface CallUsage {version:1;status:UsageStatus;reason?:UsageReason;provider?:'claude'|'codex';tokens?:UsageTokens;models?:UsageModel[];model?:string;reportedCostUsd?:number;durationMs?:number;apiDurationMs?:number;numTurns?:number;recordedAt?:string}
export interface ProductionBudgetCall {id:string;key:string;stage:string;attempt:number;status:'reserved'|'sent'|'completed'|'failed'|'uncertain';at:string;updatedAt:string;usage?:CallUsage}
export interface UsageTotals extends UsageTokens {reportedCostUsd?:number;costCalls?:number;callsReported:number;callsPartial:number;callsUnavailable:number}
export interface UsageRow {id:string;stage:string;attempt:number;callStatus:ProductionBudgetCall['status'];usage?:CallUsage}
export interface ProductionBudget extends ProductionBudgetLimits {version:1;legacy:boolean;measuredSince:string;calls:ProductionBudgetCall[]}
export interface ProductionBudgetStop {kind:'calls'|'attempts';limit:number;used:number;stage:string;key:string;at:string}
export interface ProductionBudgetUsage extends ProductionBudgetLimits {measured:boolean;legacy:boolean;measuredSince?:string;used:number;remaining:number;completed:number;failed:number;inFlight:number;uncertain:number;stepAttempts:number;stop?:ProductionBudgetStop;tokens:'unavailable'|'reported'|'partial';usageTotals?:UsageTotals;usageRows:UsageRow[]}
export const DEFAULT_PRODUCTION_BUDGET:Readonly<ProductionBudgetLimits>;
export const PRODUCTION_BUDGET_RANGE:Readonly<{maxCalls:{min:number;max:number};maxAttemptsPerStep:{min:number;max:number}}>;
export class ProductionBudgetError extends Error {budgetStop:ProductionBudgetStop}
export function validateBudgetLimits(input:unknown):ProductionBudgetLimits;
export function initialBudget(limits:ProductionBudgetLimits|undefined,at:string):ProductionBudget;
export function ensureBudget(p:{budget?:ProductionBudget},at:string):ProductionBudget;
export function reserveCall(p:{budget?:ProductionBudget},call:{key:string;stage:string;attempt:number},at:string):ProductionBudgetCall;
export function markCall(p:{budget?:ProductionBudget},id:string|undefined,status:ProductionBudgetCall['status'],at:string):ProductionBudgetCall|undefined;
export function budgetStopApplies(p:{budget?:ProductionBudget;budgetStop?:ProductionBudgetStop}):boolean;
export function budgetUsage(p:{budget?:ProductionBudget;budgetStop?:ProductionBudgetStop;step?:{budgetKey?:string;callId?:string}}):ProductionBudgetUsage;
export function sanitizeBudget(value:unknown):ProductionBudget|undefined;
export function recordUsage(p:{budget?:ProductionBudget},callId:string|undefined,usage:unknown,at:string):ProductionBudgetCall|undefined;
export function sanitizeUsage(value:unknown):CallUsage|undefined;
export function modelName(value:unknown):string|undefined;
