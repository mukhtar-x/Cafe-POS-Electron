import type { RawIngredientUnitType } from '../../../types/pos';

export type InventoryEntryUnit = 'g' | 'kg' | 'mL' | 'L' | 'each';

export function getBaseUnit(unitType: RawIngredientUnitType): InventoryEntryUnit {
    return unitType === 'weight' ? 'g' : unitType === 'volume' ? 'mL' : 'each';
}

export function getLargeUnit(unitType: RawIngredientUnitType): InventoryEntryUnit | null {
    return unitType === 'weight' ? 'kg' : unitType === 'volume' ? 'L' : null;
}

export function parseBaseUnitQuantity(value: string, entryUnit: InventoryEntryUnit): number | null {
    const normalized = value.trim();
    if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
    const [whole, fractional = ''] = normalized.split('.');
    const scale = entryUnit === 'kg' || entryUnit === 'L' ? 1000 : 1;
    if (scale === 1 && fractional) return null;
    const fractionalBase = scale === 1000 ? Number(fractional.padEnd(3, '0')) : 0;
    const baseUnits = Number(whole) * scale + fractionalBase;
    return Number.isSafeInteger(baseUnits) ? baseUnits : null;
}

export function formatBaseQuantityInput(baseUnits: number, entryUnit: InventoryEntryUnit): string {
    if (entryUnit !== 'kg' && entryUnit !== 'L') return String(baseUnits);
    const whole = Math.floor(baseUnits / 1000);
    const remainder = baseUnits % 1000;
    return remainder === 0 ? String(whole) : `${whole}.${String(remainder).padStart(3, '0').replace(/0+$/, '')}`;
}

export function formatBaseUnits(baseUnits: number, unitType: RawIngredientUnitType): string {
    const baseUnit = getBaseUnit(unitType);
    if (unitType === 'count') return `${baseUnits.toLocaleString()} each`;
    const largeUnit = getLargeUnit(unitType);
    const sign = baseUnits < 0 ? '-' : '';
    const absolute = Math.abs(baseUnits);
    if (absolute < 1000) return `${baseUnits.toLocaleString()} ${baseUnit}`;
    return `${sign}${absolute.toLocaleString()} ${baseUnit} (${sign}${formatBaseQuantityInput(absolute, largeUnit!)} ${largeUnit})`;
}