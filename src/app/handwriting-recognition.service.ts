import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DictionaryService } from './dictionary.service';
import { RecognitionResult, StrokeFeatures, CharacterPattern, CharacterMatch } from './types/handwriting.types';

// Type declaration for HanziLookupJS
// Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
declare var HanziLookup: {
  init: (type: string, dataUrl: string, callback: (success: boolean) => void) => void;
  AnalyzedCharacter: new (strokes: number[][][]) => {
    analyzedStrokes: any[];
    subStrokeCount: number;
  };
  Matcher: new (datasetName: string, looseness?: number) => {
    match: (analyzedChar: any, maxResults: number, callback: (matches: Array<{character: string, score: number}>) => void) => void;
  };
  data: { [key: string]: any };
};

@Injectable({
  providedIn: 'root'
})
export class HandwritingRecognitionService {
  // HanziLookupJS initialization state
  private hanzilookupReady = false;
  private hanzilookupInitializing = false;
  
  // Comprehensive character database built from dictionary
  private characterDatabase: Map<number, CharacterPattern[]> = new Map();
  private characterDatabaseReady = false;
  private characterDatabaseInitializing = false;
  
  constructor(
    private http: HttpClient,
    private dictionaryService: DictionaryService
  ) {
    // Wait for script to load before initializing
    this.waitForHanziLookupAndInit();
    this.buildCharacterDatabase();
  }

  /**
   * Wait for HanziLookup script to load, then initialize
   */
  private waitForHanziLookupAndInit(): void {
    // Check if already available
    if (typeof HanziLookup !== 'undefined') {
      this.initializeHanziLookup();
      return;
    }

    // Poll for script to load (max 5 seconds)
    let attempts = 0;
    const maxAttempts = 50;
    const checkInterval = setInterval(() => {
      attempts++;
      if (typeof HanziLookup !== 'undefined') {
        clearInterval(checkInterval);
        this.initializeHanziLookup();
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.warn('HanziLookup script failed to load');
      }
    }, 100);
  }

  /**
   * Initialize HanziLookupJS library with data file
   */
  private initializeHanziLookup(): void {
    if (typeof HanziLookup === 'undefined') {
      console.warn('HanziLookup is not available');
      return;
    }

    if (this.hanzilookupInitializing || this.hanzilookupReady) {
      return;
    }

    this.hanzilookupInitializing = true;
    console.log('Initializing HanziLookup...');
    HanziLookup.init('mmah', '/assets/hanzilookup/mmah.json', (success: boolean) => {
      this.hanzilookupReady = success;
      this.hanzilookupInitializing = false;
      if (success) {
        console.log('HanziLookup initialized successfully', HanziLookup);
        // Check if data is loaded
        if (HanziLookup.data && HanziLookup.data['mmah']) {
          const data = HanziLookup.data['mmah'];
          console.log('HanziLookup data loaded:', {
            hasChars: !!data.chars,
            charCount: data.chars ? data.chars.length : 0,
            hasSubstrokes: !!data.substrokes,
            sampleChars: data.chars ? data.chars.slice(0, 20).map((c: any) => c[0]).join('') : 'none'
          });
          // Check if common characters are in the database
          if (data.chars) {
            const daIndex = data.chars.findIndex((c: any) => c[0] === '大');
            const wenIndex = data.chars.findIndex((c: any) => c[0] === '文');
            console.log('Character 大 found in database:', daIndex !== -1, daIndex !== -1 ? `at index ${daIndex}` : 'not found');
            console.log('Character 文 found in database:', wenIndex !== -1, wenIndex !== -1 ? `at index ${wenIndex}` : 'not found');
          }
        } else {
          console.warn('HanziLookup data not found');
        }
      } else {
        console.error('HanziLookup initialization failed');
      }
    });
  }

  /**
   * Build comprehensive character database from dictionary entries
   * Organizes characters by stroke count with their features
   */
  private buildCharacterDatabase(): void {
    if (this.characterDatabaseInitializing || this.characterDatabaseReady) {
      return;
    }

    this.characterDatabaseInitializing = true;
    this.dictionaryService.getAllEntries().subscribe(entries => {
      const charMap = new Map<string, { entry: any; strokeCount: number }>();
      
      // Collect all single-character entries with their stroke counts
      entries.forEach(entry => {
        if (entry.simplified.length === 1 && /[\u4e00-\u9fff]/.test(entry.simplified)) {
          const strokeCount = this.dictionaryService.getStrokeCount(entry.simplified);
          if (!charMap.has(entry.simplified) || charMap.get(entry.simplified)!.strokeCount > strokeCount) {
            charMap.set(entry.simplified, { entry, strokeCount });
          }
        }
        if (entry.traditional.length === 1 && entry.traditional !== entry.simplified && /[\u4e00-\u9fff]/.test(entry.traditional)) {
          const strokeCount = this.dictionaryService.getStrokeCount(entry.traditional);
          if (!charMap.has(entry.traditional) || charMap.get(entry.traditional)!.strokeCount > strokeCount) {
            charMap.set(entry.traditional, { entry, strokeCount });
          }
        }
      });

      // Organize by stroke count
      charMap.forEach(({ entry, strokeCount }, character) => {
        if (!this.characterDatabase.has(strokeCount)) {
          this.characterDatabase.set(strokeCount, []);
        }
        
        const features: Partial<StrokeFeatures> = {
          strokeCount: strokeCount
        };
        
        // Analyze character structure for features
        if (character.includes('一') || character.includes('二') || character.includes('三')) {
          features.hasHorizontal = true;
        }
        if (character.includes('丨') || character.includes('中')) {
          features.hasVertical = true;
        }
        if (character.includes('人') || character.includes('八') || character.includes('丿')) {
          features.hasDiagonal = true;
        }
        
        const pattern: CharacterPattern = {
          character: character,
          features: features,
          confidence: 0.7 // Base confidence, will be adjusted during matching
        };
        
        this.characterDatabase.get(strokeCount)!.push(pattern);
      });

      this.characterDatabaseReady = true;
      this.characterDatabaseInitializing = false;
    });
  }

  /**
   * Recognize Chinese character from canvas image
   * This method extracts the image from canvas and attempts recognition
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognizeFromCanvas(canvas: HTMLCanvasElement, strokes?: number[][][]): Observable<RecognitionResult> {
    try {
      // First try stroke-based recognition if strokes are provided
      if (strokes && strokes.length > 0) {
        return this.recognizeFromStrokes(strokes).pipe(
          switchMap(result => {
            // If stroke-based recognition found something with reasonable confidence, return it
            if (result.character && result.confidence > 0.3) {
              return of(result);
            }
            // Otherwise, try dictionary-based suggestions by stroke count
            return this.suggestCharactersByStrokeCount(strokes.length, result);
          })
        );
      }
      
      // Fallback to image analysis
      return from(this.recognizeWithImageAnalysis(canvas));
    } catch (error) {
      return of({
        character: null,
        confidence: 0,
        alternatives: []
      });
    }
  }

  /**
   * Suggest characters from dictionary based on stroke count
   * Uses comprehensive character database with proper stroke count matching
   */
  private suggestCharactersByStrokeCount(strokeCount: number, previousResult: RecognitionResult): Observable<RecognitionResult> {
    // Wait for database to be ready, or build on demand
    if (!this.characterDatabaseReady) {
      // If database not ready, try to get characters from dictionary directly
      return this.dictionaryService.getAllEntries().pipe(
        map(entries => {
          const singleCharEntries = entries.filter(e => 
            e.simplified.length === 1 && /[\u4e00-\u9fff]/.test(e.simplified)
          );
          
          // Filter by stroke count
          const matchingEntries = singleCharEntries.filter(e => {
            const count = this.dictionaryService.getStrokeCount(e.simplified);
            return Math.abs(count - strokeCount) <= 1; // Allow ±1 stroke tolerance
          });
          
          const uniqueChars = new Set<string>();
          matchingEntries.forEach(e => {
            uniqueChars.add(e.simplified);
            if (e.traditional && e.traditional.length === 1) {
              uniqueChars.add(e.traditional);
            }
          });
          
          const matchedChars = Array.from(uniqueChars).slice(0, 10);
          
          return {
            character: previousResult.character || (matchedChars.length > 0 ? matchedChars[0] : null),
            confidence: previousResult.confidence || (matchedChars.length > 0 ? 0.4 : 0.2),
            alternatives: matchedChars.slice(1, 6)
          };
        }),
        catchError(() => of(previousResult))
      );
    }
    
    // Use character database
    const candidates = this.characterDatabase.get(strokeCount) || [];
    const nearbyCandidates = [
      ...(this.characterDatabase.get(strokeCount - 1) || []),
      ...candidates,
      ...(this.characterDatabase.get(strokeCount + 1) || [])
    ];
    
    if (nearbyCandidates.length === 0) {
      return of(previousResult);
    }
    
    const characters = nearbyCandidates
      .slice(0, 10)
      .map(p => p.character);
    
    return of({
      character: previousResult.character || (characters.length > 0 ? characters[0] : null),
      confidence: previousResult.confidence || (characters.length > 0 ? 0.4 : 0.2),
      alternatives: characters.slice(1, 6)
    });
  }


  /**
   * Check if HanziLookup is ready for recognition
   */
  isReady(): boolean {
    return this.hanzilookupReady && typeof HanziLookup !== 'undefined';
  }

  /**
   * Calculate optimal looseness parameter for matching
   * Based on stroke count, character complexity, and matching context
   */
  private calculateLooseness(strokeCount: number, isDrawAhead: boolean = false): number {
    // Optimized looseness values for better accuracy
    // Lower values = stricter matching (more accurate), higher = more lenient (more false positives)
    // Start with tighter matching for better accuracy
    let baseLooseness = 0.14;
    
    // Adjust based on stroke count
    // Tighter matching for simple characters, slightly more lenient for complex ones
    if (strokeCount >= 5) {
      baseLooseness = 0.15; // Complex characters can use slightly more leniency
    } else if (strokeCount >= 4) {
      baseLooseness = 0.145; // 4 strokes like 文
    } else if (strokeCount === 3) {
      baseLooseness = 0.14; // 3 strokes like 大 - tight matching for accuracy
    } else if (strokeCount === 2) {
      baseLooseness = 0.135; // 2 strokes - very tight for accuracy
    } else if (strokeCount === 1) {
      baseLooseness = 0.13; // Single strokes need very precise matching
    }
    
    // Draw-ahead (partial recognition) needs slightly more leniency
    // since we're matching incomplete characters
    if (isDrawAhead) {
      baseLooseness += 0.005; // Small increase for partial matches
    }
    
    // Clamp to reasonable range - keep it tight for accuracy
    return Math.max(0.12, Math.min(0.17, baseLooseness));
  }

  /**
   * Client-side stroke-based recognition
   * Uses HanziLookupJS as primary method, falls back to basic matching
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognizeFromStrokes(strokes: number[][][]): Observable<RecognitionResult> {
    if (!strokes || strokes.length === 0) {
      return of({
        character: null,
        confidence: 0,
        alternatives: []
      });
    }

    // Normalize and preprocess stroke data
    const normalizedStrokes = this.normalizeStrokes(strokes);
    
    // Try HanziLookupJS first if available and ready
    if (this.isReady()) {
      return new Observable<RecognitionResult>(observer => {
        try {
          // Validate normalized strokes before passing to HanziLookup
          if (!normalizedStrokes || normalizedStrokes.length === 0) {
            console.error('No normalized strokes to analyze');
            this.fallbackRecognition(normalizedStrokes, strokes.length).subscribe(observer);
            return;
          }
          
          // Ensure all strokes are valid (non-empty arrays with at least 2 points)
          const validStrokes = normalizedStrokes.filter(stroke => 
            stroke && Array.isArray(stroke) && stroke.length >= 2
          );
          
          if (validStrokes.length === 0) {
            console.error('No valid strokes after validation');
            this.fallbackRecognition(normalizedStrokes, strokes.length).subscribe(observer);
            return;
          }
          
          // Normalized strokes are in format [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
          // Create AnalyzedCharacter from strokes
          const analyzedChar = new HanziLookup.AnalyzedCharacter(validStrokes);
          
          // Create Matcher with optimal looseness based on stroke characteristics
          const looseness = this.calculateLooseness(validStrokes.length, false);
          const matcher = new HanziLookup.Matcher('mmah', looseness);
          
          console.log('Calling HanziLookup.Matcher.match with strokes:', {
            strokeCount: normalizedStrokes.length,
            firstStroke: normalizedStrokes[0]?.slice(0, 3),
            isReady: this.isReady(),
            hasData: !!(HanziLookup.data && HanziLookup.data['mmah']),
            looseness: looseness
          });

          // Call match with sufficient results to get good matches
          // Request more results to ensure we catch common characters that might rank lower
          matcher.match(analyzedChar, 500, (results: Array<{character: string, score: number}>) => {
            console.log('HanziLookup.Matcher.match callback called with results:', results?.length || 0, results);
            // Log all results to help debug
            if (results && results.length > 0) {
              // Check score ordering - log first few and last few to understand sorting
              console.log('First 5 results:', results.slice(0, 5).map(r => `${r.character}(${r.score})`).join(', '));
              console.log('Last 5 results:', results.slice(-5).map(r => `${r.character}(${r.score})`).join(', '));
              
              // Check for common characters in results
              const commonChars = ['大', '文', '人', '中', '一', '二', '三'];
              commonChars.forEach(char => {
                const index = results.findIndex(r => r.character === char);
                if (index !== -1) {
                  const score = results[index].score;
                  const firstScore = results[0].score;
                  const lastScore = results[results.length - 1].score;
                  console.log(`Common character ${char} found at position ${index} with score ${score} (first: ${firstScore}, last: ${lastScore})`);
                } else {
                  console.log(`Common character ${char} NOT found in top ${results.length} results`);
                }
              });
            }
            if (results && results.length > 0) {
              // Filter out results with invalid scores
              const validResults = results.filter(r => 
                r.score !== -Infinity && 
                r.score !== Infinity && 
                !isNaN(r.score) &&
                isFinite(r.score)
              );
              
              if (validResults.length === 0) {
                console.log('No valid results after filtering');
                this.fallbackRecognition(normalizedStrokes, strokes.length).subscribe(observer);
                return;
              }
              
              // HanziLookup returns results sorted by score, but lower scores = better matches
              // Sort by score ascending (lowest/best first)
              validResults.sort((a, b) => a.score - b.score);
              
              // Log top results after sorting to verify
              console.log('Top 10 results after sorting:', validResults.slice(0, 10).map((r, i) => `${i+1}. ${r.character} (${r.score.toFixed(2)})`).join(', '));
              
              // Convert scores to confidence
              // HanziLookupJS uses lower scores for better matches
              const bestResult = validResults[0];
              const confidence = this.calculateConfidence(validResults, 0);
              
              // Get alternatives from top results (no manual boosting)
              const alternatives = validResults.slice(1, 11).map(r => r.character);
              
              console.log('Recognition result:', bestResult.character, 'confidence:', confidence, 'alternatives:', alternatives);
              
              observer.next({
                character: bestResult.character,
                confidence: confidence,
                alternatives: alternatives
              });
            } else {
              console.log('No results from HanziLookup, trying fallback');
              // No results from HanziLookupJS, try fallback
              this.fallbackRecognition(normalizedStrokes, strokes.length).subscribe(observer);
            }
            observer.complete();
          });
        } catch (error) {
          console.error('HanziLookup recognition error:', error);
          // Fallback on error
          this.fallbackRecognition(normalizedStrokes, strokes.length).subscribe(observer);
        }
      });
    } else {
      console.log('HanziLookup not ready, using fallback. Ready:', this.hanzilookupReady, 'HanziLookup defined:', typeof HanziLookup !== 'undefined');
    }
    
    // Fallback to basic recognition
    return this.fallbackRecognition(normalizedStrokes, strokes.length);
  }

  /**
   * Recognize multiple candidates for draw-ahead recognition
   * Returns array of RecognitionResult objects with top N matches
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognizeDrawAhead(strokes: number[][][], maxResults: number = 20): Observable<RecognitionResult[]> {
    if (!strokes || strokes.length === 0) {
      return of([]);
    }

    // Normalize and preprocess stroke data
    const normalizedStrokes = this.normalizeStrokes(strokes);
    
    // Try HanziLookupJS first if available and ready
    if (this.isReady()) {
      return new Observable<RecognitionResult[]>(observer => {
        try {
          // Validate normalized strokes before passing to HanziLookup
          if (!normalizedStrokes || normalizedStrokes.length === 0) {
            console.error('No normalized strokes to analyze (draw-ahead)');
            this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults).subscribe(observer);
            return;
          }
          
          // Ensure all strokes are valid (non-empty arrays with at least 2 points)
          const validStrokes = normalizedStrokes.filter(stroke => 
            stroke && Array.isArray(stroke) && stroke.length >= 2
          );
          
          if (validStrokes.length === 0) {
            console.error('No valid strokes after validation (draw-ahead)');
            this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults).subscribe(observer);
            return;
          }
          
          // Normalized strokes are in format [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
          // Create AnalyzedCharacter from strokes
          const analyzedChar = new HanziLookup.AnalyzedCharacter(validStrokes);
          
          // Create Matcher with optimal looseness for draw-ahead (partial recognition)
          const looseness = this.calculateLooseness(validStrokes.length, true);
          const matcher = new HanziLookup.Matcher('mmah', looseness);
          
          console.log('Calling HanziLookup.Matcher.match (draw-ahead) with strokes:', {
            strokeCount: normalizedStrokes.length,
            firstStroke: normalizedStrokes[0]?.slice(0, 3),
            looseness: looseness
          });

          // Call match with sufficient results for draw-ahead recognition
          // Request more results to ensure we catch common characters
          matcher.match(analyzedChar, Math.max(maxResults, 500), (results: Array<{character: string, score: number}>) => {
            console.log('HanziLookup.Matcher.match (draw-ahead) callback called with results:', results?.length || 0);
            // Log all results to help debug
            if (results && results.length > 0) {
              console.log('All draw-ahead results:', results.map(r => {
                const scoreStr = (r.score !== -Infinity && r.score !== Infinity && !isNaN(r.score) && isFinite(r.score)) 
                  ? r.score.toFixed(2) 
                  : 'invalid';
                return `${r.character} (score: ${scoreStr})`;
              }).join(', '));
              // Debug logging for recognition results
              if (results.length > 0) {
                console.log(`Top 5 results:`, results.slice(0, 5).map(r => {
                  const scoreStr = (r.score !== -Infinity && r.score !== Infinity && !isNaN(r.score) && isFinite(r.score)) 
                    ? r.score.toFixed(2) 
                    : 'invalid';
                  return `${r.character}(${scoreStr})`;
                }).join(', '));
              }
            }
            if (results && results.length > 0) {
              // Filter out results with invalid scores (-Infinity, Infinity, NaN)
              const validResults = results.filter(r => 
                r.score !== -Infinity && 
                r.score !== Infinity && 
                !isNaN(r.score) &&
                isFinite(r.score)
              );
              
              if (validResults.length === 0) {
                console.log('No valid results after filtering');
                this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults).subscribe(observer);
                return;
              }
              
              // HanziLookup returns results sorted by score, but lower scores = better matches
              // Sort by score ascending (lowest/best first)
              validResults.sort((a, b) => a.score - b.score);
              
              // Log top results after sorting for debugging
              console.log(`Top ${Math.min(10, maxResults)} results after sorting:`, validResults.slice(0, Math.min(10, maxResults)).map((r, i) => `${i+1}. ${r.character} (${r.score.toFixed(2)})`).join(', '));
              
              // For draw-ahead, return top valid results (no manual boosting)
              const topResults = validResults.slice(0, maxResults);
              
              // Convert each result to RecognitionResult with proper confidence calculation
              const recognitionResults: RecognitionResult[] = topResults.map((result, index) => {
                const confidence = this.calculateConfidence(validResults, index);
                return {
                  character: result.character,
                  confidence: confidence,
                  alternatives: [] // Empty for draw-ahead
                };
              });
              
              // Sort by confidence descending (highest first)
              recognitionResults.sort((a, b) => b.confidence - a.confidence);
              
              console.log('Draw-ahead results (sorted by confidence):', recognitionResults.map(r => `${r.character} (${Math.round(r.confidence * 100)}%)`).join(', '));
              observer.next(recognitionResults);
            } else {
              console.log('No results from HanziLookup (draw-ahead), trying fallback');
              // No results from HanziLookupJS, try fallback
              this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults).subscribe(observer);
            }
            observer.complete();
          });
        } catch (error) {
          console.error('HanziLookup draw-ahead recognition error:', error);
          // Fallback on error
          this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults).subscribe(observer);
        }
      });
    } else {
      console.log('HanziLookup not ready for draw-ahead, using fallback');
    }
    
    // Fallback to basic recognition
    return this.fallbackDrawAheadRecognition(normalizedStrokes, strokes.length, maxResults);
  }

  /**
   * Fallback draw-ahead recognition returning multiple results
   */
  private fallbackDrawAheadRecognition(normalizedStrokes: number[][][], strokeCount: number, maxResults: number): Observable<RecognitionResult[]> {
    const strokeFeatures = this.analyzeStrokeFeatures(normalizedStrokes);
    const match = this.matchCharacter(strokeCount, strokeFeatures);
    
    if (match) {
      const results: RecognitionResult[] = [{
        character: match.character,
        confidence: match.confidence,
        alternatives: []
      }];
      
      // Add alternatives as separate results
      if (match.alternatives && match.alternatives.length > 0) {
        match.alternatives.slice(0, maxResults - 1).forEach((alt: string) => {
          results.push({
            character: alt,
            confidence: match.confidence * 0.7, // Lower confidence for alternatives
            alternatives: []
          });
        });
      }
      
      return of(results);
    }
    
    return of([]);
  }

  /**
   * Fallback recognition method using basic pattern matching
   */
  private fallbackRecognition(normalizedStrokes: number[][][], strokeCount: number): Observable<RecognitionResult> {
    // Analyze stroke characteristics
    const strokeFeatures = this.analyzeStrokeFeatures(normalizedStrokes);
    
    // Try to match against a basic character database
    const match = this.matchCharacter(strokeCount, strokeFeatures);
    
    if (match) {
      return of({
        character: match.character,
        confidence: match.confidence,
        alternatives: match.alternatives || []
      });
    }
    
    // No match found
    return of({
      character: null,
      confidence: 0,
      alternatives: []
    });
  }

  /**
   * Normalize stroke coordinates to a standard size with improved preprocessing
   * HanziLookup expects coordinates in 0-255 range (256x256 canvas)
   * Strokes are in format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   * Preserves aspect ratio and character proportions accurately
   */
  private normalizeStrokes(strokes: number[][][]): number[][][] {
    if (!strokes || strokes.length === 0) {
      return [];
    }

    // First, smooth strokes to reduce noise
    const smoothedStrokes = strokes.map(stroke => this.smoothStroke(stroke));
    
    // Find bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    smoothedStrokes.forEach(stroke => {
      stroke.forEach(point => {
        const x = point[0];
        const y = point[1];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
    });
    
    // Calculate bounding box dimensions
    const width = (maxX - minX) || 1;
    const height = (maxY - minY) || 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Target size for HanziLookup (256x256 canvas, coordinates 0-255)
    const targetSize = 256;
    
    // Improved normalization: consistent approach that matches database format
    // Key: characters should fill 60-80% of available canvas for best matching
    const maxDim = Math.max(width, height);
    const aspectRatio = width / height;
    
    // Use consistent padding that works well with database format
    // Padding should be enough to avoid edge clipping but allow good use of space
    const padding = 25;
    const availableSize = targetSize - (padding * 2);
    
    // Calculate scale to fill target percentage of available space
    // Target: 70% fill ratio for optimal matching with database
    const targetFillRatio = 0.70;
    const targetCharacterSize = availableSize * targetFillRatio;
    
    // Calculate scale needed to achieve target size
    let scale = targetCharacterSize / maxDim;
    
    // Ensure minimum scale for very small characters
    // But don't force too large - let natural scaling work
    const minScale = 0.4;
    const maxScale = 3.0; // Allow larger scale for very small input
    const finalScale = Math.max(minScale, Math.min(maxScale, scale));
    
    // Validate final scale produces reasonable character size
    const finalCharacterSize = maxDim * finalScale;
    if (finalCharacterSize < availableSize * 0.5) {
      // Character too small - increase scale
      const adjustedScale = (availableSize * 0.5) / maxDim;
      const normalized = this.normalizeStrokesWithScale(smoothedStrokes, centerX, centerY, Math.max(minScale, Math.min(maxScale, adjustedScale)), targetSize);
      this.logNormalizationParameters(minX, minY, maxX, maxY, width, height, adjustedScale, padding, strokes.length, normalized);
      return normalized;
    }
    
    // Normalize strokes using the calculated scale
    const normalized = this.normalizeStrokesWithScale(smoothedStrokes, centerX, centerY, finalScale, targetSize);
    this.logNormalizationParameters(minX, minY, maxX, maxY, width, height, finalScale, padding, strokes.length, normalized);
    return normalized;
  }

  /**
   * Normalize strokes with a specific scale factor
   * Helper method for consistent normalization
   */
  private normalizeStrokesWithScale(
    strokes: number[][][], 
    centerX: number, 
    centerY: number, 
    scale: number, 
    targetSize: number
  ): number[][][] {
    // Normalize strokes preserving aspect ratio
    // Filter out empty strokes and ensure all strokes have at least 2 points
    const normalized: number[][][] = strokes
      .filter(stroke => stroke && stroke.length >= 2) // Ensure strokes have at least 2 points
      .map(stroke => {
        return stroke
          .filter(point => point && Array.isArray(point) && point.length >= 2) // Ensure points are valid
          .map(point => {
            // Translate to center
            const translatedX = point[0] - centerX;
            const translatedY = point[1] - centerY;
            
            // Scale uniformly to preserve aspect ratio
            const scaledX = translatedX * scale;
            const scaledY = translatedY * scale;
            
            // Center in targetSize x targetSize canvas
            const normalizedX = Math.max(0, Math.min(targetSize - 1, scaledX + targetSize / 2));
            const normalizedY = Math.max(0, Math.min(targetSize - 1, scaledY + targetSize / 2));
            
            return [normalizedX, normalizedY];
          })
          .filter(point => point.length === 2 && !isNaN(point[0]) && !isNaN(point[1]) && isFinite(point[0]) && isFinite(point[1])); // Final validation
      })
      .filter(stroke => stroke && stroke.length >= 2); // Final check: strokes must have at least 2 points
    
    // Validate normalized strokes are within bounds and valid
    if (normalized.length === 0) {
      console.warn('Normalization produced no valid strokes');
      return strokes; // Return original if normalization fails
    }
    
    this.validateNormalizedStrokes(normalized);
    
    return normalized;
  }

  /**
   * Log normalization parameters for debugging
   */
  private logNormalizationParameters(
    minX: number, minY: number, maxX: number, maxY: number,
    width: number, height: number,
    scale: number, padding: number,
    strokeCount: number,
    normalized: number[][][]
  ): void {
    // Debug logging for normalization parameters
    if (console && console.log) {
      console.log('Normalization parameters:', {
        originalBounds: { minX, minY, maxX, maxY, width, height },
        scale: scale.toFixed(3),
        padding: padding.toFixed(1),
        strokeCount: strokeCount,
        normalizedBounds: this.getNormalizedBounds(normalized)
      });
    }
  }

  /**
   * Validate that normalized strokes are within expected bounds
   * Also validates stroke quality for matching accuracy
   */
  private validateNormalizedStrokes(strokes: number[][][]): void {
    const targetSize = 256;
    let hasOutOfBounds = false;
    let hasInvalidPoints = false;
    
    strokes.forEach((stroke, strokeIdx) => {
      if (!stroke || stroke.length < 2) {
        if (!hasInvalidPoints) {
          console.warn('Invalid stroke found:', { stroke: strokeIdx, length: stroke?.length });
          hasInvalidPoints = true;
        }
        return;
      }
      
      stroke.forEach((point, pointIdx) => {
        const x = point[0];
        const y = point[1];
        
        // Check bounds
        if (x < 0 || x >= targetSize || y < 0 || y >= targetSize) {
          if (!hasOutOfBounds) {
            console.warn('Normalized stroke out of bounds:', {
              stroke: strokeIdx,
              point: pointIdx,
              x, y,
              bounds: `[0, ${targetSize - 1}]`
            });
            hasOutOfBounds = true;
          }
        }
        
        // Check for invalid values
        if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
          if (!hasInvalidPoints) {
            console.warn('Invalid point values:', {
              stroke: strokeIdx,
              point: pointIdx,
              x, y
            });
            hasInvalidPoints = true;
          }
        }
      });
    });
    
    // Validate stroke distribution - characters should use reasonable portion of canvas
    const bounds = this.getNormalizedBounds(strokes);
    const usedWidth = bounds.maxX - bounds.minX;
    const usedHeight = bounds.maxY - bounds.minY;
    const minUsage = targetSize * 0.3; // At least 30% of canvas should be used
    
    if (usedWidth < minUsage && usedHeight < minUsage) {
      console.warn('Normalized character uses too little of canvas:', {
        usedWidth: usedWidth.toFixed(1),
        usedHeight: usedHeight.toFixed(1),
        minUsage: minUsage.toFixed(1)
      });
    }
  }

  /**
   * Get bounding box of normalized strokes for debugging
   */
  private getNormalizedBounds(strokes: number[][][]): { minX: number, minY: number, maxX: number, maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    strokes.forEach(stroke => {
      stroke.forEach(point => {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      });
    });
    
    return { minX, minY, maxX, maxY };
  }

  /**
   * Smooth stroke to reduce noise from hand-drawn input
   * Uses adaptive smoothing based on stroke length and point density
   * Preserves important stroke features (corners, endpoints)
   * Stroke format: [[x, y], [x, y], ...]
   */
  private smoothStroke(stroke: number[][]): number[][] {
    if (stroke.length < 3) {
      return stroke; // Too short to smooth
    }

    // Adaptive window size based on stroke length
    // Longer strokes can use larger windows, shorter strokes need smaller windows
    const baseWindowSize = 2;
    const adaptiveWindowSize = Math.min(
      baseWindowSize + Math.floor(stroke.length / 20),
      5 // Cap at 5 to avoid over-smoothing
    );
    
    const smoothed: number[][] = [];
    
    // Always preserve first and last points (endpoints are important)
    smoothed.push([stroke[0][0], stroke[0][1]]);
    
    // Smooth intermediate points
    for (let i = 1; i < stroke.length - 1; i++) {
      const windowSize = Math.min(adaptiveWindowSize, Math.min(i, stroke.length - 1 - i));
      
      let sumX = 0, sumY = 0;
      let count = 0;
      
      // Weighted average: closer points have more influence
      for (let j = Math.max(0, i - windowSize); j <= Math.min(stroke.length - 1, i + windowSize); j++) {
        const distance = Math.abs(j - i);
        const weight = windowSize + 1 - distance; // Higher weight for closer points
        
        sumX += stroke[j][0] * weight;
        sumY += stroke[j][1] * weight;
        count += weight;
      }
      
      smoothed.push([sumX / count, sumY / count]);
    }
    
    // Always preserve last point
    smoothed.push([stroke[stroke.length - 1][0], stroke[stroke.length - 1][1]]);
    
    return smoothed;
  }

  /**
   * Analyze stroke features for pattern matching
   * Stroke format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  private analyzeStrokeFeatures(strokes: number[][][]): StrokeFeatures {
    const features: StrokeFeatures = {
      strokeCount: strokes.length,
      hasHorizontal: false,
      hasVertical: false,
      hasDiagonal: false,
      hasCurves: false,
      centerX: 0,
      centerY: 0
    };
    
    // Analyze stroke directions
    strokes.forEach(stroke => {
      if (stroke.length >= 2) {
        const firstPoint = stroke[0];
        const lastPoint = stroke[stroke.length - 1];
        const dx = lastPoint[0] - firstPoint[0];
        const dy = lastPoint[1] - firstPoint[1];
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        if (Math.abs(angle) < 30 || Math.abs(angle) > 150) {
          features.hasHorizontal = true;
        }
        if (Math.abs(Math.abs(angle) - 90) < 30) {
          features.hasVertical = true;
        }
        if (Math.abs(Math.abs(angle) - 45) < 30) {
          features.hasDiagonal = true;
        }
      }
    });
    
    return features;
  }

  /**
   * Match character based on stroke count and features
   * Uses comprehensive character database built from dictionary
   */
  private matchCharacter(strokeCount: number, features: StrokeFeatures): CharacterMatch | null {
    // Use character database if available
    if (this.characterDatabaseReady) {
      const candidates = [
        ...(this.characterDatabase.get(strokeCount - 1) || []),
        ...(this.characterDatabase.get(strokeCount) || []),
        ...(this.characterDatabase.get(strokeCount + 1) || [])
      ];
      
      if (candidates.length === 0) {
        return null;
      }
      
      // Find best matching candidate based on features
      let bestMatch: CharacterPattern | null = null;
      let bestScore = 0;
      
      for (const candidate of candidates) {
        let score = 0;
        const candidateFeatures = candidate.features;
        
        // Score based on feature matches
        if (candidateFeatures.hasHorizontal && features.hasHorizontal) {
          score += 0.3;
        }
        if (candidateFeatures.hasVertical && features.hasVertical) {
          score += 0.3;
        }
        if (candidateFeatures.hasDiagonal && features.hasDiagonal) {
          score += 0.3;
        }
        
        // Prefer exact stroke count match
        if (candidateFeatures.strokeCount === strokeCount) {
          score += 0.2;
        }
        
        // Base confidence from the pattern
        score += candidate.confidence * 0.1;
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
      
      if (bestMatch && bestScore > 0.2) {
        const alternatives = candidates
          .filter(c => c.character !== bestMatch!.character)
          .slice(0, 5)
          .map(c => c.character);
        
        return {
          character: bestMatch.character,
          confidence: Math.min(0.7, bestScore),
          alternatives: alternatives
        };
      } else if (candidates.length > 0) {
        // Return first candidate as fallback with lower confidence
        return {
          character: candidates[0].character,
          confidence: 0.4,
          alternatives: candidates.slice(1, 6).map(c => c.character)
        };
      }
    }
    
    // Fallback to basic patterns for common characters
    const basicPatterns: Map<number, CharacterPattern[]> = new Map([
      [1, [
        { character: '一', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '丨', features: { hasVertical: true }, confidence: 0.9 },
        { character: '丶', features: {}, confidence: 0.7 },
        { character: '丿', features: { hasDiagonal: true }, confidence: 0.8 }
      ]],
      [2, [
        { character: '二', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '人', features: { hasDiagonal: true }, confidence: 0.8 },
        { character: '十', features: { hasVertical: true, hasHorizontal: true }, confidence: 0.9 },
        { character: '八', features: { hasDiagonal: true }, confidence: 0.7 }
      ]],
      [3, [
        { character: '三', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '大', features: { hasHorizontal: true, hasDiagonal: true }, confidence: 0.8 },
        { character: '口', features: {}, confidence: 0.7 },
        { character: '小', features: {}, confidence: 0.6 },
        { character: '山', features: {}, confidence: 0.6 }
      ]]
    ]);
    
    const candidates = basicPatterns.get(strokeCount) || [];
    if (candidates.length === 0) {
      return null;
    }
    
    // Find best match
    let bestMatch: CharacterPattern | null = null;
    let bestScore = 0;
    
    for (const candidate of candidates) {
      let score = 0;
      const candidateFeatures = candidate.features;
      
      if (candidateFeatures.hasHorizontal && features.hasHorizontal) {
        score += 0.3;
      }
      if (candidateFeatures.hasVertical && features.hasVertical) {
        score += 0.3;
      }
      if (candidateFeatures.hasDiagonal && features.hasDiagonal) {
        score += 0.3;
      }
      score += candidate.confidence * 0.1;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    
    if (bestMatch && bestScore > 0.2) {
      return {
        character: bestMatch.character,
        confidence: Math.min(0.7, bestScore),
        alternatives: candidates
          .filter(c => c.character !== bestMatch!.character)
          .slice(0, 3)
          .map(c => c.character)
      };
    } else if (candidates.length > 0) {
      return {
        character: candidates[0].character,
        confidence: 0.4,
        alternatives: candidates.slice(1, 4).map(c => c.character)
      };
    }
    
    return null;
  }

  /**
   * Calculate confidence from HanziLookup score
   * HanziLookup uses lower scores for better matches
   * Handles edge cases like identical scores and very small ranges
   */
  private calculateConfidence(results: Array<{character: string, score: number}>, index: number): number {
    if (results.length === 0) {
      return 0;
    }
    
    if (results.length === 1) {
      // Single result - use moderate confidence
      return 0.7;
    }
    
    const bestScore = results[0].score;
    const worstScore = results[results.length - 1].score;
    const scoreRange = worstScore - bestScore;
    
    // Handle edge case: all scores are identical or very close
    if (scoreRange < 0.001) {
      // Scores are essentially identical - use position-based confidence
      return Math.max(0.3, 0.9 - (index * 0.05));
    }
    
    const currentScore = results[index].score;
    
    // Calculate how much better/worse this score is relative to the best
    // Lower score = better match
    const scoreDifference = currentScore - bestScore;
    const normalizedDifference = scoreRange > 0 ? scoreDifference / scoreRange : 0;
    
    // Improved confidence calculation for better accuracy
    // Top match gets very high confidence, others drop more sharply
    let baseConfidence: number;
    
    if (index === 0) {
      // Best match - very high confidence
      baseConfidence = 0.95;
    } else if (normalizedDifference < 0.1) {
      // Very close to best match - high confidence
      baseConfidence = 0.85 - (normalizedDifference * 2);
    } else if (normalizedDifference < 0.3) {
      // Reasonably close - moderate confidence
      baseConfidence = 0.75 - (normalizedDifference * 0.5);
    } else {
      // Further from best - lower confidence
      baseConfidence = Math.max(0.2, 0.6 - (normalizedDifference * 0.8));
    }
    
    // Add small position-based boost for top 3 results
    const positionBoost = index < 3 ? (3 - index) * 0.02 : 0;
    
    return Math.max(0.1, Math.min(0.95, baseConfidence + positionBoost));
  }

  /**
   * Use browser's built-in handwriting recognition if available
   */
  async recognizeWithBrowserAPI(canvas: HTMLCanvasElement): Promise<RecognitionResult> {
    // Check if browser supports handwriting recognition
    if ('HandwritingRecognition' in window || 'webkitHandwritingRecognition' in window) {
      try {
        // Browser API would go here
        // This is experimental and not widely supported
        return {
          character: null,
          confidence: 0,
          alternatives: []
        };
      } catch (error) {
        // Browser recognition not available
      }
    }
    
    return {
      character: null,
      confidence: 0,
      alternatives: []
    };
  }

  /**
   * Fallback: Use a simple image comparison approach
   * This analyzes the drawn character and tries to match it
   */
  async recognizeWithImageAnalysis(canvas: HTMLCanvasElement): Promise<RecognitionResult> {
    // Get image data
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Check if there's actually content drawn
    let hasContent = false;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] < 255) { // Not fully transparent/white
        hasContent = true;
        break;
      }
    }
    
    if (!hasContent) {
      return {
        character: null,
        confidence: 0,
        alternatives: []
      };
    }
    
    // Image-only recognition requires external ML services
    // Primary recognition uses stroke-based methods (HanziLookupJS)
    return {
      character: null,
      confidence: 0,
      alternatives: []
    };
  }
}
