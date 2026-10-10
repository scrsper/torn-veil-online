import {EntitySchema,type EntityDescription} from './schema';
/** Torn Veil owns the mapping. This boundary accepts a read-only projection, never a live sim object. */
export interface CanonicalAppearanceAdapter<T>{toAppearance(entity:Readonly<T>):EntityDescription;}
export function projectAppearance<T>(entity:Readonly<T>,adapter:CanonicalAppearanceAdapter<T>){return EntitySchema.parse(adapter.toAppearance(entity));}
