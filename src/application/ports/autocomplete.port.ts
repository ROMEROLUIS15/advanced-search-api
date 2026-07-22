import type { AutocompleteItem } from '../models/autocomplete-item';

export const AUTOCOMPLETE_PORT = Symbol('AUTOCOMPLETE_PORT');

export interface AutocompletePort {
  complete(prefix: string, limit: number): Promise<AutocompleteItem[]>;
}
