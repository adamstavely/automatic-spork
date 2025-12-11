import { Injectable } from '@angular/core';
import { Observable, of, forkJoin } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { DictionaryService, DictionaryEntry } from './dictionary.service';

@Injectable({
  providedIn: 'root'
})
export class PinyinInputService {
  constructor(private dictionaryService: DictionaryService) {}

  /**
   * Normalize pinyin input (handle tones, ü, etc.)
   */
  normalizePinyin(pinyin: string): string {
    return pinyin
      .toLowerCase()
      .replace(/\s+/g, '') // Remove spaces
      .replace(/v/g, 'ü') // Replace v with ü
      .replace(/[1-5]/g, '') // Remove tone numbers for matching
      .trim();
  }

  /**
   * Convert pinyin (with/without tones) to characters
   */
  convertPinyinToCharacters(pinyin: string): Observable<string[]> {
    if (!pinyin || pinyin.length === 0) {
      return of([]);
    }

    const normalized = this.normalizePinyin(pinyin);
    
    return this.dictionaryService.searchByPinyin(normalized).pipe(
      map(entries => {
        const characters = new Set<string>();
        entries.forEach(entry => {
          // Add both simplified and traditional
          if (entry.simplified.length === 1) {
            characters.add(entry.simplified);
          }
          if (entry.traditional.length === 1 && entry.traditional !== entry.simplified) {
            characters.add(entry.traditional);
          }
        });
        return Array.from(characters);
      })
    );
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1,     // insertion
            dp[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Generate pinyin variations for fuzzy matching
   */
  private generatePinyinVariations(pinyin: string): string[] {
    const variations = new Set<string>();
    variations.add(pinyin);

    // Common typos and variations
    if (pinyin.length > 1) {
      variations.add(pinyin.slice(0, -1)); // Remove last char
      variations.add(pinyin + 'a');
      variations.add(pinyin + 'o');
      variations.add(pinyin + 'e');
      variations.add(pinyin + 'i');
      variations.add(pinyin + 'u');
    }

    // Common character substitutions
    const substitutions: { [key: string]: string[] } = {
      'zh': ['z', 'j'],
      'ch': ['c', 'q'],
      'sh': ['s', 'x'],
      'z': ['zh'],
      'c': ['ch'],
      's': ['sh'],
      'j': ['zh'],
      'q': ['ch'],
      'x': ['sh']
    };

    for (let i = 0; i < pinyin.length; i++) {
      const char = pinyin[i];
      if (substitutions[char]) {
        substitutions[char].forEach(sub => {
          variations.add(pinyin.slice(0, i) + sub + pinyin.slice(i + 1));
        });
      }
    }

    return Array.from(variations);
  }

  /**
   * Fuzzy match pinyin with tolerance for typos using Levenshtein distance
   */
  fuzzyMatchPinyin(pinyin: string, tolerance: number = 1): Observable<string[]> {
    if (!pinyin || pinyin.length === 0) {
      return of([]);
    }

    const normalized = this.normalizePinyin(pinyin);
    
    // First try exact match
    return this.convertPinyinToCharacters(pinyin).pipe(
      switchMap(exactMatches => {
        if (exactMatches.length > 0) {
          return of(exactMatches);
        }
        
        // If no exact matches and tolerance > 0, try fuzzy matching with Levenshtein distance
        if (tolerance <= 0) {
          return of([]);
        }

        // Get all unique pinyin strings from dictionary
        return this.dictionaryService.getAllEntries().pipe(
          map(entries => {
            const pinyinMap = new Map<string, Set<string>>();
            
            // Build map of normalized pinyin to characters
            entries.forEach(entry => {
              const entryPinyin = this.normalizePinyin(entry.pinyin);
              if (!pinyinMap.has(entryPinyin)) {
                pinyinMap.set(entryPinyin, new Set());
              }
              if (entry.simplified.length === 1) {
                pinyinMap.get(entryPinyin)!.add(entry.simplified);
              }
              if (entry.traditional.length === 1 && entry.traditional !== entry.simplified) {
                pinyinMap.get(entryPinyin)!.add(entry.traditional);
              }
            });

            // Find pinyin strings within tolerance distance
            const results = new Set<string>();
            pinyinMap.forEach((characters, entryPinyin) => {
              const distance = this.levenshteinDistance(normalized, entryPinyin);
              if (distance <= tolerance) {
                characters.forEach(char => results.add(char));
              }
            });

            return Array.from(results);
          })
        );
      })
    );
  }

  /**
   * Get pinyin auto-complete suggestions
   */
  getPinyinSuggestions(partialPinyin: string, limit: number = 20): Observable<string[]> {
    if (!partialPinyin || partialPinyin.length < 1) {
      return of([]);
    }

    const normalized = this.normalizePinyin(partialPinyin);
    
    return this.dictionaryService.getAllEntries().pipe(
      map(entries => {
        const pinyinSet = new Set<string>();
        
        for (const entry of entries) {
          const entryPinyin = this.normalizePinyin(entry.pinyin);
          if (entryPinyin.startsWith(normalized) && entryPinyin !== normalized) {
            pinyinSet.add(entry.pinyin); // Keep original with tones
            if (pinyinSet.size >= limit) break;
          }
        }
        
        return Array.from(pinyinSet).slice(0, limit);
      })
    );
  }

  /**
   * Check if input looks like pinyin
   */
  isPinyin(input: string): boolean {
    if (!input || input.length === 0) return false;
    
    // Pinyin contains letters, possibly with tone numbers (1-5) or tone marks
    const pinyinPattern = /^[a-züv\s\d]+$/i;
    const hasTone = /[1-5]|[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(input);
    
    return pinyinPattern.test(input) && (hasTone || /^[a-züv]+$/i.test(input.replace(/\s/g, '')));
  }
}
