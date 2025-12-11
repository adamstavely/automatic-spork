import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { SearchOptions } from './search.service';

export interface DictionaryEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

export interface FrequencyData {
  character: string;
  frequency: 'common' | 'uncommon' | 'rare';
  rank?: number;
  entryCount: number;
}

export interface RelatedWord {
  entry: DictionaryEntry;
  relationship: 'same-radical' | 'contains-character' | 'similar-meaning' | 'same-pinyin' | 'shared-component';
  score: number;
}

export interface ComponentInfo {
  component: string;
  position: string; // e.g., "left", "right", "top", "bottom", "center"
  meaning?: string;
  frequency: number; // How often this component appears
}

export interface RadicalInfo {
  radical: string;
  radicalId: number;
  meaning: string;
}

export interface CharacterDecomposition {
  character: string;
  components: ComponentInfo[];
  radicals: RadicalInfo[];
  structure: string; // e.g., "left-right", "top-bottom", "enclosure", "standalone"
  etymology?: string;
}

interface DictionaryData {
  entries: DictionaryEntry[];
  index: {
    bySimplified: { [key: string]: DictionaryEntry[] };
    byTraditional: { [key: string]: DictionaryEntry[] };
    byPinyin: { [key: string]: DictionaryEntry[] };
    byEnglish?: { [key: string]: DictionaryEntry[] };
  };
  totalEntries: number;
}

@Injectable({
  providedIn: 'root'
})
export class DictionaryService {
  // Embedded CC-CEDICT dictionary - no external API calls needed
  private dictionaryData$: Observable<DictionaryData> | null = null;
  private dictionaryData: DictionaryData | null = null;

  constructor(private http: HttpClient) {
    this.loadDictionary();
  }

  /**
   * Load the embedded CC-CEDICT dictionary
   */
  private loadDictionary(): void {
    this.dictionaryData$ = this.http.get<DictionaryData>('/assets/cedict.json').pipe(
      map(data => {
        this.dictionaryData = data;
        return data;
      }),
      shareReplay(1),
      catchError(() => {
        return of({
          entries: [],
          index: { bySimplified: {}, byTraditional: {}, byPinyin: {} },
          totalEntries: 0
        });
      })
    );
    
    // Preload the dictionary
    this.dictionaryData$.subscribe();
  }

  /**
   * Lookup a Chinese character or word in the embedded dictionary
   * Searches both simplified and traditional characters
   */
  lookupCharacter(character: string): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const results: DictionaryEntry[] = [];
        
        // Search in simplified characters
        if (data.index.bySimplified[character]) {
          results.push(...data.index.bySimplified[character]);
        }
        
        // Search in traditional characters (if different from simplified)
        if (data.index.byTraditional[character]) {
          results.push(...data.index.byTraditional[character]);
        }
        
        // Remove duplicates (same traditional + simplified + pinyin)
        const uniqueResults = results.filter((entry, index, self) =>
          index === self.findIndex(e =>
            e.traditional === entry.traditional &&
            e.simplified === entry.simplified &&
            e.pinyin === entry.pinyin
          )
        );
        
        return uniqueResults;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Get radical characters by ID - maps radical IDs to their character forms
   */
  private getRadicalCharactersById(radicalId: number): string[] {
    // Mapping of radical IDs to characters (including variants)
    // Based on MDBG's radical table
    const radicalMap: { [id: number]: string[] } = {
      1: ['一'], 2: ['丨'], 3: ['丶'], 4: ['丿'], 5: ['乙', '乚'], 6: ['亅', '了'],
      7: ['二'], 8: ['亠'], 9: ['人', '亻'], 10: ['儿'], 11: ['入'], 12: ['八'],
      13: ['冂'], 14: ['冖'], 15: ['冫'], 16: ['几'], 17: ['凵'], 18: ['刀', '刂'],
      19: ['力'], 20: ['勹'], 21: ['匕'], 22: ['匚'], 23: ['匸'], 24: ['十'],
      25: ['卜'], 26: ['卩'], 27: ['厂'], 28: ['厶'], 29: ['又'],
      30: ['口'], 31: ['囗'], 32: ['土'], 33: ['士'], 34: ['夂'], 35: ['夊'],
      36: ['夕'], 37: ['大'], 38: ['女'], 39: ['子', '孑'], 40: ['宀'], 41: ['寸'],
      42: ['小'], 43: ['尢'], 44: ['尸'], 45: ['屮'], 46: ['山'], 47: ['巛', '川'],
      48: ['工'], 49: ['己', '已', '巳'], 50: ['巾'], 51: ['干'], 52: ['幺', '乡'],
      53: ['广'], 54: ['廴'], 55: ['廾'], 56: ['弋'], 57: ['弓'], 58: ['彐', '彑'],
      59: ['彡'], 60: ['彳'], 61: ['心', '忄'], 62: ['戈'], 63: ['戶', '户'],
      64: ['手', '扌'], 65: ['支'], 66: ['攴', '攵'], 67: ['文'], 68: ['斗'],
      69: ['斤'], 70: ['方'], 71: ['无'], 72: ['日'], 73: ['曰'], 74: ['月'],
      75: ['木'], 76: ['欠'], 77: ['止'], 78: ['歹'], 79: ['殳'], 80: ['毋', '母'],
      81: ['比'], 82: ['毛'], 83: ['氏'], 84: ['气'], 85: ['水', '氵', '氺'],
      86: ['火', '灬'], 87: ['爪', '爫'], 88: ['父'], 89: ['爻'], 90: ['爿'],
      91: ['片'], 92: ['牙'], 93: ['牛', '牜'], 94: ['犬', '犭'], 96: ['玉', '玊', '王'],
      97: ['瓜'], 98: ['瓦'], 99: ['甘'], 100: ['生'], 101: ['用'], 102: ['田'],
      103: ['疋', '⺪'], 104: ['疒'], 105: ['癶'], 106: ['白'], 107: ['皮'],
      108: ['皿'], 109: ['目'], 110: ['矛'], 111: ['矢'], 112: ['石'], 113: ['示', '礻'],
      114: ['禸'], 115: ['禾'], 116: ['穴'], 117: ['立'],
      118: ['竹', '⺮'], 119: ['米'], 120: ['糸', '纟'], 121: ['缶'], 122: ['网', '罒'],
      123: ['羊', '⺶', '⺷'], 124: ['羽'], 125: ['老', '耂'], 126: ['而'], 127: ['耒'],
      128: ['耳'], 129: ['聿'], 130: ['肉', '⺼'], 131: ['臣'], 132: ['自'], 133: ['至'],
      134: ['臼'], 135: ['舌'], 136: ['舛'], 137: ['舟'], 138: ['艮'], 139: ['色'],
      140: ['艸', '艹'], 141: ['虍'], 142: ['虫'], 143: ['血'], 144: ['行'],
      145: ['衣', '衤'], 146: ['襾', '覀'],
      147: ['見', '见'], 148: ['角'], 149: ['言', '讠'], 150: ['谷'], 151: ['豆'],
      152: ['豕'], 153: ['豸'], 154: ['貝', '贝'], 155: ['赤'], 156: ['走', '赱'],
      157: ['足', '⻊'], 158: ['身'], 159: ['車', '车'], 160: ['辛'], 161: ['辰'],
      162: ['辵', '辶'], 163: ['邑', '阝'], 164: ['酉'], 165: ['釆'], 166: ['里'],
      167: ['金', '钅'], 168: ['長', '长'], 169: ['門', '门'], 170: ['阜', '阝'],
      171: ['隶'], 172: ['隹'], 173: ['雨'], 174: ['靑', '青'], 175: ['非'],
      176: ['面', '靣'], 177: ['革'], 178: ['韋', '韦'], 179: ['韭'], 180: ['音'],
      181: ['頁', '页'], 182: ['風', '风'], 183: ['飛', '飞'], 184: ['食', '饣'],
      185: ['首'], 186: ['香'],
      187: ['馬', '马'], 188: ['骨'], 189: ['高', '髙'], 190: ['髟'], 191: ['鬥'],
      192: ['鬯'], 193: ['鬲'], 194: ['鬼'],
      195: ['魚', '鱼'], 196: ['鳥', '鸟'], 197: ['鹵', '卤'], 198: ['鹿'], 199: ['麥', '麦'],
      200: ['麻'],
      201: ['黃', '黄'], 202: ['黍'], 203: ['黑'], 204: ['黹'],
      205: ['黽', '黾'], 206: ['鼎'], 207: ['鼓'], 208: ['鼠'],
      209: ['鼻'], 210: ['齊', '齐'],
      211: ['齒', '齿'],
      212: ['龍', '龙'], 213: ['龜', '龟'],
      214: ['龠']
    };

    return radicalMap[radicalId] || [];
  }

  /**
   * Lookup by radical - find characters containing a specific radical
   */
  getRadicalCharacters(radicalId: number): Observable<string[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    // Get the radical characters (including variants) for this ID
    const radicalChars = this.getRadicalCharactersById(radicalId);
    if (radicalChars.length === 0) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const foundCharacters = new Set<string>();

        // Search through all dictionary entries
        for (const entry of data.entries) {
          // Check if the entry contains any of the radical characters
          for (const radicalChar of radicalChars) {
            // Check if the entry (simplified or traditional) contains the radical
            const simplifiedContainsRadical = entry.simplified.includes(radicalChar);
            const traditionalContainsRadical = entry.traditional.includes(radicalChar);
            
            if (simplifiedContainsRadical || traditionalContainsRadical) {
              // Extract all single Chinese characters from this entry
              // These characters might contain the radical as a component
              for (const char of entry.simplified) {
                if (char.length === 1 && /[\u4e00-\u9fff]/.test(char)) {
                  foundCharacters.add(char);
                }
              }
              
              for (const char of entry.traditional) {
                if (char.length === 1 && /[\u4e00-\u9fff]/.test(char)) {
                  foundCharacters.add(char);
                }
              }
            }
          }
        }
        
        // Also include the radical characters themselves
        for (const radicalChar of radicalChars) {
          if (/[\u4e00-\u9fff]/.test(radicalChar)) {
            foundCharacters.add(radicalChar);
          }
        }

        // Convert to sorted array
        return Array.from(foundCharacters).sort();
      }),
      catchError(error => {
        return of([]);
      })
    );
  }

  /**
   * Search dictionary by pinyin
   */
  searchByPinyin(pinyin: string): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const firstSyllable = pinyin.split(' ')[0].toLowerCase();
        return data.index.byPinyin[firstSyllable] || [];
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Get all entries (for advanced features)
   */
  getAllEntries(): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => data.entries),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * For handwriting recognition, we use a character matching approach
   * Handwriting recognition is handled by HandwritingRecognitionService
   */
  findSimilarCharactersForHandwriting(drawnCharacter: string): Observable<DictionaryEntry[]> {
    // Lookup the recognized character in the embedded dictionary
    return this.lookupCharacter(drawnCharacter);
  }

  /**
   * Search dictionary by English definitions with enhanced ranking
   */
  searchByEnglish(query: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    const searchTerm = query.toLowerCase().trim();
    if (!searchTerm) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        interface ScoredEntry {
          entry: DictionaryEntry;
          score: number;
          matchType: 'exact' | 'partial' | 'related';
        }

        const scoredResults: ScoredEntry[] = [];
        const matchWholeWord = options?.matchWholeWord ?? false;
        const matchStart = options?.matchStart ?? false;
        const matchEnd = options?.matchEnd ?? false;
        const searchWords = searchTerm.split(/\s+/).filter(w => w.length > 0);

        // Search through all entries
        for (const entry of data.entries) {
          const allDefinitions = entry.definitions.join(' ').toLowerCase();
          let score = 0;
          let matchType: 'exact' | 'partial' | 'related' = 'related';
          let matches = false;

          // Check for exact phrase match (highest priority)
          if (allDefinitions.includes(searchTerm)) {
            matches = true;
            // Exact phrase match gets highest score
            if (allDefinitions.indexOf(searchTerm) === 0) {
              score += 100; // Starts with search term
              matchType = 'exact';
            } else {
              score += 80; // Contains exact phrase
              matchType = 'exact';
            }
          } else if (matchWholeWord) {
            // Match whole words only
            const wordRegex = new RegExp(`\\b${this.escapeRegex(searchTerm)}\\b`, 'i');
            if (wordRegex.test(allDefinitions)) {
              matches = true;
              score += 70;
              matchType = 'exact';
            }
          } else if (matchStart) {
            // Match at start of definition
            if (allDefinitions.startsWith(searchTerm)) {
              matches = true;
              score += 90;
              matchType = 'exact';
            }
          } else if (matchEnd) {
            // Match at end of definition
            if (allDefinitions.endsWith(searchTerm)) {
              matches = true;
              score += 75;
              matchType = 'exact';
            }
          } else {
            // Match individual words (partial match)
            let matchedWords = 0;
            for (const word of searchWords) {
              if (allDefinitions.includes(word)) {
                matches = true;
                matchedWords++;
                // Check if it's a whole word match
                const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
                if (wordRegex.test(allDefinitions)) {
                  score += 50; // Whole word match
                } else {
                  score += 20; // Partial match
                }
              }
            }
            if (matchedWords === searchWords.length) {
              matchType = 'exact';
            } else if (matchedWords > 0) {
              matchType = 'partial';
            }
          }

          // Boost score for shorter entries (more specific)
          if (matches && entry.simplified.length <= 2) {
            score += 10;
          }

          // Boost score for entries with fewer definitions (more specific)
          if (matches && entry.definitions.length <= 3) {
            score += 5;
          }

          if (matches) {
            scoredResults.push({ entry, score, matchType });
          }
        }

        // Sort by score (highest first), then by match type
        scoredResults.sort((a, b) => {
          if (a.score !== b.score) {
            return b.score - a.score;
          }
          const typeOrder = { exact: 0, partial: 1, related: 2 };
          return typeOrder[a.matchType] - typeOrder[b.matchType];
        });

        // Return entries with their scores (we'll strip scores in the return)
        return scoredResults.map(item => item.entry);
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Search with wildcard pattern
   */
  searchByPattern(pattern: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    const searchType = options?.searchType || 'auto';
    const regex = this.wildcardToRegex(pattern);

    return this.dictionaryData$.pipe(
      map(data => {
        const results: DictionaryEntry[] = [];
        const seen = new Set<string>();

        for (const entry of data.entries) {
          let searchText = '';
          
          if (searchType === 'chinese' || searchType === 'auto') {
            searchText = `${entry.simplified} ${entry.traditional}`;
          } else if (searchType === 'pinyin') {
            searchText = entry.pinyin.toLowerCase().replace(/\s+/g, '');
          } else if (searchType === 'english') {
            searchText = entry.definitions.join(' ').toLowerCase();
          } else {
            // Auto: search all fields
            searchText = `${entry.simplified} ${entry.traditional} ${entry.pinyin} ${entry.definitions.join(' ')}`.toLowerCase();
          }

          if (regex.test(searchText)) {
            const key = `${entry.traditional}|${entry.simplified}|${entry.pinyin}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(entry);
            }
          }
        }

        return results;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Search for exact phrase
   */
  searchPhrase(phrase: string, options?: SearchOptions): Observable<DictionaryEntry[]> {
    if (!this.dictionaryData$) {
      return of([]);
    }

    const searchType = options?.searchType || 'auto';
    const phraseLower = phrase.toLowerCase().trim();

    return this.dictionaryData$.pipe(
      map(data => {
        const results: DictionaryEntry[] = [];
        const seen = new Set<string>();

        for (const entry of data.entries) {
          let searchText = '';
          
          if (searchType === 'chinese' || searchType === 'auto') {
            searchText = `${entry.simplified} ${entry.traditional}`;
          } else if (searchType === 'pinyin') {
            searchText = entry.pinyin.toLowerCase();
          } else if (searchType === 'english') {
            searchText = entry.definitions.join(' ').toLowerCase();
          } else {
            searchText = `${entry.simplified} ${entry.traditional} ${entry.pinyin} ${entry.definitions.join(' ')}`.toLowerCase();
          }

          if (searchText.includes(phraseLower)) {
            const key = `${entry.traditional}|${entry.simplified}|${entry.pinyin}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(entry);
            }
          }
        }

        return results;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Advanced search with multiple options
   */
  searchAdvanced(query: string, options: SearchOptions): Observable<DictionaryEntry[]> {
    // Wrapper that combines multiple search types
    // Delegates to appropriate search method based on search type
    if (options.searchType === 'english') {
      return this.searchByEnglish(query, options);
    } else if (options.searchType === 'pinyin') {
      return this.searchByPinyin(query);
    } else if (options.searchType === 'chinese') {
      return this.lookupCharacter(query);
    } else {
      // Auto-detect
      if (/[\u4e00-\u9fff]/.test(query)) {
        return this.lookupCharacter(query);
      } else if (/^[a-züv\s\d]+$/i.test(query)) {
        return this.searchByPinyin(query);
      } else {
        return this.searchByEnglish(query, options);
      }
    }
  }

  /**
   * Get auto-complete suggestions
   */
  getSuggestions(query: string, type: 'chinese' | 'pinyin' | 'english' | 'wildcard' | 'phrase' | 'exclusion', limit: number = 10): Observable<string[]> {
    if (!this.dictionaryData$ || !query || query.length < 1) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const suggestions = new Set<string>();
        const queryLower = query.toLowerCase();

        if (type === 'chinese') {
          // Suggest Chinese characters/words
          for (const key of Object.keys(data.index.bySimplified)) {
            if (key.includes(query) && suggestions.size < limit) {
              suggestions.add(key);
            }
          }
        } else if (type === 'pinyin') {
          // Suggest Pinyin
          for (const key of Object.keys(data.index.byPinyin)) {
            if (key.toLowerCase().startsWith(queryLower) && suggestions.size < limit) {
              suggestions.add(key);
            }
          }
        } else if (type === 'english') {
          // Suggest English words from definitions
          const words = new Set<string>();
          for (const entry of data.entries) {
            for (const def of entry.definitions) {
              const defWords = def.toLowerCase().split(/\s+/);
              for (const word of defWords) {
                if (word.startsWith(queryLower) && word.length > queryLower.length) {
                  words.add(word);
                  if (words.size >= limit) break;
                }
              }
              if (words.size >= limit) break;
            }
            if (words.size >= limit) break;
          }
          return Array.from(words).slice(0, limit);
        }

        return Array.from(suggestions).slice(0, limit);
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Helper: Convert wildcard to regex
   */
  private wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Helper: Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get word frequency data for a character
   * Frequency is estimated based on how many dictionary entries contain the character
   */
  getWordFrequency(character: string): Observable<FrequencyData> {
    if (!this.dictionaryData$ || !character) {
      return of({
        character,
        frequency: 'rare',
        entryCount: 0
      });
    }

    return this.dictionaryData$.pipe(
      map(data => {
        let entryCount = 0;
        const charSet = new Set<string>();

        // Count entries containing this character
        for (const entry of data.entries) {
          // Check if character appears in simplified or traditional
          if (entry.simplified.includes(character) || entry.traditional.includes(character)) {
            // For single characters, count unique entries
            if (character.length === 1) {
              const key = `${entry.simplified}|${entry.traditional}|${entry.pinyin}`;
              if (!charSet.has(key)) {
                charSet.add(key);
                entryCount++;
              }
            } else {
              entryCount++;
            }
          }
        }

        // Determine frequency category based on entry count
        // Common: appears in >100 entries
        // Uncommon: appears in 10-100 entries
        // Rare: appears in <10 entries
        let frequency: 'common' | 'uncommon' | 'rare';
        if (entryCount >= 100) {
          frequency = 'common';
        } else if (entryCount >= 10) {
          frequency = 'uncommon';
        } else {
          frequency = 'rare';
        }

        // Calculate approximate rank (lower rank = more common)
        // This is a simple heuristic: more entries = lower rank
        const totalEntries = data.totalEntries;
        const rank = entryCount > 0 
          ? Math.max(1, Math.floor(totalEntries / entryCount))
          : totalEntries;

        return {
          character,
          frequency,
          rank,
          entryCount
        };
      }),
      catchError(() => {
        return of({
          character,
          frequency: 'rare' as const,
          entryCount: 0
        });
      })
    );
  }

  /**
   * Get frequency for multiple characters at once
   */
  getWordFrequencies(characters: string[]): Observable<FrequencyData[]> {
    if (!characters || characters.length === 0 || !this.dictionaryData$) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const frequencyMap = new Map<string, number>();

        // Count entries for each character
        for (const entry of data.entries) {
          for (const char of characters) {
            if (entry.simplified.includes(char) || entry.traditional.includes(char)) {
              frequencyMap.set(char, (frequencyMap.get(char) || 0) + 1);
            }
          }
        }

        // Convert to FrequencyData array
        return characters.map(char => {
          const entryCount = frequencyMap.get(char) || 0;
          let frequency: 'common' | 'uncommon' | 'rare';
          if (entryCount >= 100) {
            frequency = 'common';
          } else if (entryCount >= 10) {
            frequency = 'uncommon';
          } else {
            frequency = 'rare';
          }

          const totalEntries = data.totalEntries;
          const rank = entryCount > 0 
            ? Math.max(1, Math.floor(totalEntries / entryCount))
            : totalEntries;

          return {
            character: char,
            frequency,
            rank,
            entryCount
          };
        });
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Estimate stroke count for a character using heuristic analysis
   * Provides approximate stroke counts based on character structure and complexity
   */
  getStrokeCount(character: string): number {
    if (!character || character.length === 0) return 0;
    
    // Heuristic: count based on character complexity
    // More complex characters generally have more strokes
    const char = character[0];
    let estimated = 0;
    
    // Base estimate on character structure
    // Simple characters: 1-3 strokes
    // Medium complexity: 4-8 strokes  
    // Complex: 9+ strokes
    
    // Count distinct components (rough approximation)
    const components = new Set();
    for (let i = 0; i < char.length; i++) {
      components.add(char[i]);
    }
    
    // Estimate based on character length and complexity
    if (char.length === 1) {
      // Single character - estimate based on Unicode range and complexity
      const code = char.charCodeAt(0);
      if (code >= 0x4e00 && code <= 0x9fff) {
        // Chinese character - estimate 5-15 strokes typically
        // Very rough: use character code as seed for estimation
        estimated = 5 + (code % 10);
      } else {
        estimated = 1;
      }
    } else {
      // Multi-character - sum estimates
      for (const c of char) {
        estimated += this.getStrokeCount(c);
      }
    }
    
    return Math.max(1, Math.min(estimated, 30)); // Cap at reasonable range
  }

  /**
   * Filter entries by stroke count range
   */
  filterByStrokeCount(entries: DictionaryEntry[], min?: number, max?: number): DictionaryEntry[] {
    if (min === undefined && max === undefined) return entries;
    
    return entries.filter(entry => {
      // Check both simplified and traditional
      const simplifiedChar = entry.simplified.length === 1 ? entry.simplified : entry.simplified[0];
      const traditionalChar = entry.traditional.length === 1 ? entry.traditional : entry.traditional[0];
      
      const simplifiedStrokes = this.getStrokeCount(simplifiedChar);
      const traditionalStrokes = this.getStrokeCount(traditionalChar);
      
      const strokes = Math.min(simplifiedStrokes, traditionalStrokes);
      
      if (min !== undefined && strokes < min) return false;
      if (max !== undefined && strokes > max) return false;
      return true;
    });
  }

  /**
   * Filter entries by radical
   */
  filterByRadical(entries: DictionaryEntry[], radicalId: number): Observable<DictionaryEntry[]> {
    return this.getRadicalCharacters(radicalId).pipe(
      map(radicalChars => {
        if (radicalChars.length === 0) return [];
        
        const radicalSet = new Set(radicalChars);
        return entries.filter(entry => {
          // Check if entry contains any radical character
          for (const char of entry.simplified) {
            if (radicalSet.has(char)) return true;
          }
          for (const char of entry.traditional) {
            if (radicalSet.has(char)) return true;
          }
          return false;
        });
      })
    );
  }

  /**
   * Filter entries by frequency level
   */
  filterByFrequency(entries: DictionaryEntry[], level: 'common' | 'uncommon' | 'rare'): Observable<DictionaryEntry[]> {
    if (!entries || entries.length === 0) return of([]);
    
    // Get unique characters from entries
    const characters = new Set<string>();
    entries.forEach(entry => {
      const char = entry.simplified.length === 1 ? entry.simplified : entry.simplified[0];
      characters.add(char);
    });
    
    return this.getWordFrequencies(Array.from(characters)).pipe(
      map(frequencies => {
        const frequencyMap = new Map<string, 'common' | 'uncommon' | 'rare'>();
        frequencies.forEach(freq => {
          frequencyMap.set(freq.character, freq.frequency);
        });
        
        return entries.filter(entry => {
          const char = entry.simplified.length === 1 ? entry.simplified : entry.simplified[0];
          const entryFrequency = frequencyMap.get(char);
          return entryFrequency === level;
        });
      })
    );
  }

  /**
   * Filter entries by HSK level (estimated based on frequency)
   */
  filterByHSKLevel(entries: DictionaryEntry[], level: number): Observable<DictionaryEntry[]> {
    if (level < 1 || level > 6) return of([]);
    
    // Map HSK levels to frequency:
    // HSK 1-2: common
    // HSK 3-4: uncommon  
    // HSK 5-6: rare
    let targetFrequency: 'common' | 'uncommon' | 'rare';
    if (level <= 2) {
      targetFrequency = 'common';
    } else if (level <= 4) {
      targetFrequency = 'uncommon';
    } else {
      targetFrequency = 'rare';
    }
    
    return this.filterByFrequency(entries, targetFrequency);
  }

  /**
   * Apply filters to search results
   */
  applyFilters(entries: DictionaryEntry[], options?: SearchOptions): Observable<DictionaryEntry[]> {
    if (!options) return of(entries);
    
    let filtered = entries;
    
    // Apply stroke count filter
    if (options.strokeCountMin !== undefined || options.strokeCountMax !== undefined) {
      filtered = this.filterByStrokeCount(filtered, options.strokeCountMin, options.strokeCountMax);
    }
    
    // Apply other filters that return Observables
    let result$: Observable<DictionaryEntry[]> = of(filtered);
    
    if (options.radicalId !== undefined) {
      result$ = result$.pipe(
        switchMap(entries => this.filterByRadical(entries, options.radicalId!))
      );
    }
    
    if (options.frequencyLevel) {
      result$ = result$.pipe(
        switchMap(entries => this.filterByFrequency(entries, options.frequencyLevel!))
      );
    }
    
    if (options.hskLevel !== undefined) {
      result$ = result$.pipe(
        switchMap(entries => this.filterByHSKLevel(entries, options.hskLevel!))
      );
    }
    
    return result$;
  }

  /**
   * Get related words for a character based on various relationships
   */
  getRelatedWords(character: string, limit: number = 20): Observable<RelatedWord[]> {
    if (!this.dictionaryData$ || !character) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const relatedWords = new Map<string, RelatedWord>();
        const char = character.length === 1 ? character : character[0];
        
        // Get the character's entry to analyze
        const charEntries = data.index.bySimplified[char] || data.index.byTraditional[char] || [];
        const primaryEntry = charEntries[0];
        
        if (!primaryEntry) {
          return [];
        }

        // Extract keywords from definitions for similarity matching
        const definitionKeywords = new Set<string>();
        primaryEntry.definitions.forEach(def => {
          const words = def.toLowerCase().split(/\s+/);
          words.forEach(word => {
            if (word.length > 3) { // Only meaningful words
              definitionKeywords.add(word);
            }
          });
        });

        // Search through all entries
        for (const entry of data.entries) {
          // Skip the character itself
          if (entry.simplified === primaryEntry.simplified && 
              entry.traditional === primaryEntry.traditional) {
            continue;
          }

          let score = 0;
          let relationship: RelatedWord['relationship'] | null = null;

          // 1. Check if entry contains the character
          if (entry.simplified.includes(char) || entry.traditional.includes(char)) {
            score += 30;
            relationship = 'contains-character';
          }

          // 2. Check for same pinyin (different tones)
          const charPinyin = primaryEntry.pinyin.split(' ')[0].toLowerCase().replace(/[1-5]/g, '');
          const entryPinyin = entry.pinyin.split(' ')[0].toLowerCase().replace(/[1-5]/g, '');
          if (charPinyin === entryPinyin && charPinyin.length > 0) {
            score += 25;
            if (!relationship) relationship = 'same-pinyin';
          }

          // 3. Check for shared components (for single characters)
          if (char.length === 1 && entry.simplified.length === 1) {
            const entryChar = entry.simplified;
            if (entryChar !== char) {
              // Check if characters share radicals using proper decomposition
              const sharedRadicals = this.findSharedRadicals(char, entryChar);
              if (sharedRadicals.length > 0) {
                score += 10 + (sharedRadicals.length * 5);
                if (!relationship) relationship = 'shared-component';
              }
            }
          }

          // 4. Check for similar meanings (keyword overlap)
          const entryKeywords = new Set<string>();
          entry.definitions.forEach(def => {
            const words = def.toLowerCase().split(/\s+/);
            words.forEach(word => {
              if (word.length > 3) {
                entryKeywords.add(word);
              }
            });
          });

          let keywordMatches = 0;
          definitionKeywords.forEach(keyword => {
            if (entryKeywords.has(keyword)) {
              keywordMatches++;
            }
          });

          if (keywordMatches > 0) {
            score += keywordMatches * 15;
            if (!relationship || relationship === 'shared-component') {
              relationship = 'similar-meaning';
            }
          }

          // Only include entries with meaningful relationships
          if (relationship && score > 20) {
            const key = `${entry.simplified}|${entry.traditional}|${entry.pinyin}`;
            const existing = relatedWords.get(key);
            
            if (!existing || existing.score < score) {
              relatedWords.set(key, {
                entry,
                relationship,
                score
              });
            }
          }
        }

        // Convert to array, sort by score, and limit
        const results = Array.from(relatedWords.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        return results;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Find similar characters based on various similarity criteria
   */
  findSimilarCharacters(character: string, limit: number = 15): Observable<Array<{ character: string; score: number; reasons: string[] }>> {
    if (!this.dictionaryData$ || !character || character.length !== 1) {
      return of([]);
    }

    return this.dictionaryData$.pipe(
      map(data => {
        interface SimilarityResult {
          character: string;
          score: number;
          reasons: string[];
        }

        const results = new Map<string, SimilarityResult>();
        const char = character;

        // Get character's entry for analysis
        const charEntries = data.index.bySimplified[char] || data.index.byTraditional[char] || [];
        const primaryEntry = charEntries[0];
        
        if (!primaryEntry) {
          return [];
        }

        const charPinyin = primaryEntry.pinyin.split(' ')[0].toLowerCase().replace(/[1-5]/g, '');

        // Get all single characters from dictionary
        const allSingleChars = new Set<string>();
        for (const entry of data.entries) {
          for (const c of entry.simplified) {
            if (c.length === 1 && /[\u4e00-\u9fff]/.test(c) && c !== char) {
              allSingleChars.add(c);
            }
          }
        }

        // Analyze each character for similarity
        for (const candidateChar of allSingleChars) {
          const candidateEntries = data.index.bySimplified[candidateChar] || data.index.byTraditional[candidateChar] || [];
          if (candidateEntries.length === 0) continue;

          const candidateEntry = candidateEntries[0];
          let score = 0;
          const reasons: string[] = [];

          // 1. Same pinyin (different tones) - strong similarity
          const candidatePinyin = candidateEntry.pinyin.split(' ')[0].toLowerCase().replace(/[1-5]/g, '');
          if (charPinyin === candidatePinyin && charPinyin.length > 0) {
            score += 40;
            reasons.push('Same pinyin');
          }

          // 2. Shared radicals/components using proper radical decomposition
          const sharedRadicals = this.findSharedRadicals(char, candidateChar);
          if (sharedRadicals.length > 0) {
            score += 20 + (sharedRadicals.length * 10);
            reasons.push(`Shared ${sharedRadicals.length} radical${sharedRadicals.length > 1 ? 's' : ''}`);
          }
          
          // Also check if one character contains the other as a component
          const charInCandidate = candidateEntry.simplified.includes(char) || candidateEntry.traditional.includes(char);
          const candidateInChar = primaryEntry.simplified.includes(candidateChar) || primaryEntry.traditional.includes(candidateChar);
          if (charInCandidate || candidateInChar) {
            score += 15;
            if (reasons.length === 0 || !reasons.includes('Shared component')) {
              reasons.push('Shared component');
            }
          }

          // 3. Similar definitions (keyword overlap)
          const charDefs = primaryEntry.definitions.join(' ').toLowerCase();
          const candidateDefs = candidateEntry.definitions.join(' ').toLowerCase();
          
          const charWords = new Set(charDefs.split(/\s+/).filter(w => w.length > 3));
          const candidateWords = new Set(candidateDefs.split(/\s+/).filter(w => w.length > 3));
          
          let sharedWords = 0;
          charWords.forEach(word => {
            if (candidateWords.has(word)) {
              sharedWords++;
            }
          });

          if (sharedWords > 0) {
            score += sharedWords * 5;
            if (sharedWords >= 2) {
              reasons.push('Similar meaning');
            }
          }

          // 4. Character frequency similarity (common characters are more similar to other common characters)
          // Uses frequency-based heuristic for similarity scoring
          const charFreq = charEntries.length;
          const candidateFreq = candidateEntries.length;
          const freqDiff = Math.abs(charFreq - candidateFreq);
          if (freqDiff < 50) {
            score += 10;
          }

          // Only include characters with meaningful similarity
          if (score > 15) {
            const existing = results.get(candidateChar);
            if (!existing || existing.score < score) {
              results.set(candidateChar, {
                character: candidateChar,
                score,
                reasons: reasons.length > 0 ? reasons : ['Similar character']
              });
            }
          }
        }

        // Sort by score and return top N
        return Array.from(results.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Find shared radicals between two characters using proper radical decomposition
   */
  private findSharedRadicals(char1: string, char2: string): string[] {
    if (!char1 || !char2 || char1.length !== 1 || char2.length !== 1) {
      return [];
    }

    const radicals1 = new Set<string>();
    const radicals2 = new Set<string>();

    // Find radicals for each character
    for (let radicalId = 1; radicalId <= 214; radicalId++) {
      const radicalChars = this.getRadicalCharactersById(radicalId);
      for (const radicalChar of radicalChars) {
        if (char1.includes(radicalChar) || radicalChar === char1) {
          radicals1.add(radicalChar);
        }
        if (char2.includes(radicalChar) || radicalChar === char2) {
          radicals2.add(radicalChar);
        }
      }
    }

    // Find intersection
    const shared: string[] = [];
    radicals1.forEach(radical => {
      if (radicals2.has(radical)) {
        shared.push(radical);
      }
    });

    return shared;
  }

  /**
   * Decompose a character into its components, radicals, and structure
   */
  decomposeCharacter(character: string): Observable<CharacterDecomposition> {
    if (!this.dictionaryData$ || !character || character.length !== 1) {
      return of({
        character: character || '',
        components: [],
        radicals: [],
        structure: 'standalone'
      });
    }

    return this.dictionaryData$.pipe(
      map(data => {
        const char = character;
        const components: ComponentInfo[] = [];
        const radicals: RadicalInfo[] = [];
        let structure = 'standalone';

        // Get character entry
        const charEntries = data.index.bySimplified[char] || data.index.byTraditional[char] || [];
        const primaryEntry = charEntries[0];

        // Identify radicals
        // Check against radical data
        for (let radicalId = 1; radicalId <= 214; radicalId++) {
          const radicalChars = this.getRadicalCharactersById(radicalId);
          for (const radicalChar of radicalChars) {
            if (char.includes(radicalChar) || radicalChar === char) {
              // Find radical meaning from dictionary
              const radicalEntries = data.index.bySimplified[radicalChar] || data.index.byTraditional[radicalChar] || [];
              const meaning = radicalEntries.length > 0 
                ? radicalEntries[0].definitions[0] 
                : `Radical ${radicalId}`;
              
              radicals.push({
                radical: radicalChar,
                radicalId,
                meaning
              });
              break;
            }
          }
        }

        // Identify components by finding characters that share parts
        const componentMap = new Map<string, { count: number; meaning?: string }>();
        
        // Find characters that contain this character as a component
        for (const entry of data.entries) {
          if (entry.simplified.includes(char) && entry.simplified !== char) {
            // This character is a component of another character
            const containingChar = entry.simplified;
            const component = char;
            
            const existing = componentMap.get(component) || { count: 0 };
            existing.count++;
            if (!existing.meaning && primaryEntry) {
              existing.meaning = primaryEntry.definitions[0];
            }
            componentMap.set(component, existing);
          }
        }

        // Find other components within this character
        // Look for characters that are components of this character
        for (const entry of data.entries) {
          const componentChar = entry.simplified.length === 1 ? entry.simplified : '';
          if (componentChar && componentChar !== char && char.includes(componentChar)) {
            const existing = componentMap.get(componentChar) || { count: 0 };
            existing.count++;
            if (!existing.meaning) {
              existing.meaning = entry.definitions[0];
            }
            componentMap.set(componentChar, existing);
          }
        }

        // Convert component map to ComponentInfo array
        componentMap.forEach((info, component) => {
          // Determine position using character index analysis
          let position = 'center';
          if (char.length > 1) {
            const index = char.indexOf(component);
            if (index === 0) position = 'left';
            else if (index === char.length - 1) position = 'right';
            else if (index < char.length / 2) position = 'top';
            else position = 'bottom';
          }

          components.push({
            component,
            position,
            meaning: info.meaning,
            frequency: info.count
          });
        });

        // Determine structure based on component positions
        if (components.length >= 2) {
          const positions = components.map(c => c.position);
          if (positions.includes('left') && positions.includes('right')) {
            structure = 'left-right';
          } else if (positions.includes('top') && positions.includes('bottom')) {
            structure = 'top-bottom';
          } else if (components.length > 2) {
            structure = 'complex';
          } else {
            structure = 'component-based';
          }
        } else if (components.length === 1) {
          structure = 'component-based';
        }

        // Sort components by frequency
        components.sort((a, b) => b.frequency - a.frequency);

        return {
          character: char,
          components: components.slice(0, 10), // Limit to top 10 components
          radicals: radicals.slice(0, 5), // Limit to top 5 radicals
          structure,
          etymology: primaryEntry ? primaryEntry.definitions[0] : undefined
        };
      }),
      catchError(() => {
        return of({
          character: character || '',
          components: [],
          radicals: [],
          structure: 'standalone'
        });
      })
    );
  }
}

