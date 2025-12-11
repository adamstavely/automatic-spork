import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { DictionaryService, DictionaryEntry } from './dictionary.service';

export interface SearchOptions {
  searchType?: 'chinese' | 'pinyin' | 'english' | 'auto';
  matchWholeWord?: boolean;
  matchStart?: boolean;
  matchEnd?: boolean;
  excludeTerms?: string[];
  strokeCountMin?: number;
  strokeCountMax?: number;
  radicalId?: number;
  frequencyLevel?: 'common' | 'uncommon' | 'rare';
  hskLevel?: number;
}

export interface SearchQuery {
  originalQuery: string;
  query: string;
  type: 'chinese' | 'pinyin' | 'english' | 'wildcard' | 'phrase' | 'exclusion';
  patterns?: string[];
  excludeTerms?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  constructor(private dictionaryService: DictionaryService) {}

  /**
   * Parse search query to determine type and extract patterns
   */
  parseQuery(query: string): SearchQuery {
    const trimmed = query.trim();
    if (!trimmed) {
      return { originalQuery: query, query: '', type: 'chinese' };
    }

    // Check for exclusion pattern: "term -exclude"
    const exclusionMatch = trimmed.match(/^(.+?)\s+-(.+)$/);
    if (exclusionMatch) {
      return {
        originalQuery: query,
        query: exclusionMatch[1].trim(),
        type: 'exclusion',
        excludeTerms: [exclusionMatch[2].trim()]
      };
    }

    // Check for quoted phrase: "exact phrase"
    const phraseMatch = trimmed.match(/^"(.+)"$/);
    if (phraseMatch) {
      return {
        originalQuery: query,
        query: phraseMatch[1],
        type: 'phrase'
      };
    }

    // Check for wildcard pattern: contains *
    if (trimmed.includes('*')) {
      return {
        originalQuery: query,
        query: trimmed,
        type: 'wildcard',
        patterns: [trimmed]
      };
    }

    // Check for prefix: c:, p:, e:
    const prefixMatch = trimmed.match(/^(c|p|e):(.+)$/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      const searchTerm = prefixMatch[2].trim();
      return {
        originalQuery: query,
        query: searchTerm,
        type: prefix === 'c' ? 'chinese' : prefix === 'p' ? 'pinyin' : 'english'
      };
    }

    // Auto-detect type
    const detectedType = this.detectQueryType(trimmed);
    return {
      originalQuery: query,
      query: trimmed,
      type: detectedType
    };
  }

  /**
   * Detect query type (Chinese, Pinyin, or English)
   */
  detectQueryType(query: string): 'chinese' | 'pinyin' | 'english' {
    // Check if contains Chinese characters
    if (/[\u4e00-\u9fff]/.test(query)) {
      return 'chinese';
    }

    // Check if looks like Pinyin (contains letters, possibly with tone numbers)
    if (/^[a-züv\s\d]+$/i.test(query) && !/^[a-z\s]+$/i.test(query.replace(/[0-9\s]/g, ''))) {
      return 'pinyin';
    }

    // Default to English
    return 'english';
  }

  /**
   * Normalize Pinyin input
   */
  normalizePinyin(pinyin: string): string {
    return pinyin
      .toLowerCase()
      .replace(/\s+/g, '') // Remove spaces
      .replace(/v/g, 'ü') // Replace v with ü
      .trim();
  }

  /**
   * Convert wildcard pattern to regex
   */
  wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*'); // Convert * to .*
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Search with auto-detection and pattern matching
   */
  search(query: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    const parsed = this.parseQuery(query);
    
    let searchResult$: Observable<DictionaryEntry[]>;
    
    switch (parsed.type) {
      case 'chinese':
        searchResult$ = this.searchChinese(parsed.query, options);
        break;
      case 'pinyin':
        searchResult$ = this.searchPinyin(parsed.query, options);
        break;
      case 'english':
        searchResult$ = this.searchEnglish(parsed.query, options);
        break;
      case 'wildcard':
        searchResult$ = this.searchWildcard(parsed.query, options);
        break;
      case 'phrase':
        searchResult$ = this.searchPhrase(parsed.query, options);
        break;
      case 'exclusion':
        searchResult$ = this.searchWithExclusion(parsed.query, parsed.excludeTerms || [], options);
        break;
      default:
        searchResult$ = of([]);
    }
    
    // Apply filters if any are specified
    if (options && (options.strokeCountMin !== undefined || options.strokeCountMax !== undefined ||
        options.radicalId !== undefined || options.frequencyLevel || options.hskLevel !== undefined)) {
      return searchResult$.pipe(
        switchMap(results => this.dictionaryService.applyFilters(results, options))
      );
    }
    
    return searchResult$;
  }

  /**
   * Search Chinese characters
   */
  searchChinese(query: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    return this.dictionaryService.lookupCharacter(query);
  }

  /**
   * Search by Pinyin
   */
  searchPinyin(query: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    const normalized = this.normalizePinyin(query);
    
    // If contains wildcards, use pattern matching
    if (normalized.includes('*')) {
      return this.searchWildcard(normalized, { ...options, searchType: 'pinyin' });
    }

    return this.dictionaryService.searchByPinyin(normalized);
  }

  /**
   * Search by English definitions
   */
  searchEnglish(query: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    return this.dictionaryService.searchByEnglish(query, options);
  }

  /**
   * Search with wildcard pattern
   */
  searchWildcard(pattern: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    return this.dictionaryService.searchByPattern(pattern, options);
  }

  /**
   * Search exact phrase
   */
  searchPhrase(phrase: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    return this.dictionaryService.searchPhrase(phrase, options);
  }

  /**
   * Search with exclusion terms
   */
  searchWithExclusion(query: string, excludeTerms: string[], options?: SearchOptions): Observable<DictionaryEntry[]> {
    return this.search(query, options).pipe(
      map(results => {
        return results.filter(entry => {
          const searchText = `${entry.simplified} ${entry.traditional} ${entry.pinyin} ${entry.definitions.join(' ')}`.toLowerCase();
          return !excludeTerms.some(term => searchText.includes(term.toLowerCase()));
        });
      })
    );
  }

  /**
   * Get auto-complete suggestions
   */
  getSuggestions(query: string, limit: number = 10): Observable<string[]> {
    if (!query || query.length < 1) {
      return of([]);
    }

    const parsed = this.parseQuery(query);
    // For suggestions, use the underlying query type
    // If it's a wildcard/phrase/exclusion, detect the base type
    let suggestionType: 'chinese' | 'pinyin' | 'english' = 'chinese';
    
    if (parsed.type === 'chinese' || parsed.type === 'wildcard' || parsed.type === 'phrase' || parsed.type === 'exclusion') {
      // Detect the base type from the query
      suggestionType = this.detectQueryType(parsed.query);
    } else if (parsed.type === 'pinyin') {
      suggestionType = 'pinyin';
    } else if (parsed.type === 'english') {
      suggestionType = 'english';
    }

    return this.dictionaryService.getSuggestions(parsed.query, suggestionType, limit);
  }
}
