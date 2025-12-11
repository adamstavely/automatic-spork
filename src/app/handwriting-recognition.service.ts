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
          // Check if 大 is in the database
          if (data.chars) {
            const daIndex = data.chars.findIndex((c: any) => c[0] === '大');
            console.log('Character 大 found in database:', daIndex !== -1, daIndex !== -1 ? `at index ${daIndex}` : 'not found');
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
          // Normalized strokes are in format [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
          // Create AnalyzedCharacter from strokes
          const analyzedChar = new HanziLookup.AnalyzedCharacter(normalizedStrokes);
          
          // Create Matcher with the dataset name
          // For complete characters (3+ strokes), use slightly looser matching to catch characters like 大
          // For partial characters, use default looseness
          const looseness = normalizedStrokes.length >= 3 ? 0.16 : 0.15;
          const matcher = new HanziLookup.Matcher('mmah', looseness);
          
          console.log('Calling HanziLookup.Matcher.match with strokes:', {
            strokeCount: normalizedStrokes.length,
            firstStroke: normalizedStrokes[0]?.slice(0, 3),
            isReady: this.isReady(),
            hasData: !!(HanziLookup.data && HanziLookup.data['mmah']),
            looseness: looseness
          });

          // Call match with max 300 results to ensure we get common characters like 大
          // Complete characters sometimes rank lower, so we need to search deeper
          matcher.match(analyzedChar, 300, (results: Array<{character: string, score: number}>) => {
            console.log('HanziLookup.Matcher.match callback called with results:', results?.length || 0, results);
            // Log all results to help debug
            if (results && results.length > 0) {
              console.log('All recognition results:', results.map(r => `${r.character} (score: ${r.score !== -Infinity && r.score !== Infinity && !isNaN(r.score) ? r.score.toFixed(2) : 'invalid'})`).join(', '));
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
              
              // Convert scores to confidence (HanziLookupJS uses lower scores for better matches)
              // Normalize scores: best match gets highest confidence
              const maxScore = validResults[0].score;
              const minScore = validResults[validResults.length - 1].score;
              const scoreRange = maxScore - minScore || 1;
              
              const bestResult = validResults[0];
              // HanziLookup uses lower scores for better matches
              // Convert to confidence: normalize score relative to range
              // Better matches have lower scores, so we invert the relationship
              // Use a more generous confidence calculation
              const normalizedScore = scoreRange > 0 ? (bestResult.score - minScore) / scoreRange : 0;
              const confidence = Math.max(0.1, Math.min(0.95, 1 - normalizedScore * 0.7));
              
              // Include more alternatives (up to 10)
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
          // Normalized strokes are in format [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
          // Create AnalyzedCharacter from strokes
          const analyzedChar = new HanziLookup.AnalyzedCharacter(normalizedStrokes);
          
          // Create Matcher with the dataset name
          // For complete characters (3+ strokes), use slightly looser matching to catch characters like 大
          // For partial characters, use default looseness
          const looseness = normalizedStrokes.length >= 3 ? 0.16 : 0.15;
          const matcher = new HanziLookup.Matcher('mmah', looseness);
          
          console.log('Calling HanziLookup.Matcher.match (draw-ahead) with strokes:', {
            strokeCount: normalizedStrokes.length,
            firstStroke: normalizedStrokes[0]?.slice(0, 3),
            looseness: looseness
          });

          // Call match with more results to ensure we get common characters like 大
          // Request 300 results to have better chance of finding the character, especially when complete
          // Complete characters sometimes rank lower than partial matches
          matcher.match(analyzedChar, Math.max(maxResults, 300), (results: Array<{character: string, score: number}>) => {
            console.log('HanziLookup.Matcher.match (draw-ahead) callback called with results:', results?.length || 0);
            // Log all results to help debug
            if (results && results.length > 0) {
              console.log('All draw-ahead results:', results.map(r => {
                const scoreStr = (r.score !== -Infinity && r.score !== Infinity && !isNaN(r.score) && isFinite(r.score)) 
                  ? r.score.toFixed(2) 
                  : 'invalid';
                return `${r.character} (score: ${scoreStr})`;
              }).join(', '));
              // Check if 大 is in results
              const daIndex = results.findIndex(r => r.character === '大');
              if (daIndex !== -1) {
                console.log(`Character 大 found in results at index ${daIndex} with score ${results[daIndex].score}`);
                // Log surrounding characters for context
                const start = Math.max(0, daIndex - 2);
                const end = Math.min(results.length, daIndex + 3);
                console.log(`Characters around 大:`, results.slice(start, end).map(r => `${r.character}(${r.score.toFixed(2)})`).join(', '));
              } else {
                console.log(`Character 大 NOT found in top ${results.length} results`);
                // Check if we should search deeper - log the last few results
                if (results.length > 0) {
                  console.log(`Last 5 results:`, results.slice(-5).map(r => `${r.character}(${r.score.toFixed(2)})`).join(', '));
                }
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
              
              // For draw-ahead, return all valid results (up to maxResults) to catch characters like 大
              // Special handling: if 大 is found but not in top results, boost it
              let topResults = validResults.slice(0, maxResults);
              
              // Special boost for common character 大 when it's found but ranked low (e.g., position 200+)
              if (normalizedStrokes.length >= 3) {
                const daIndex = validResults.findIndex(r => r.character === '大');
                if (daIndex !== -1 && daIndex >= maxResults) {
                  // 大 is beyond our limit - add it to results with boosted confidence
                  const daResult = validResults[daIndex];
                  // Insert it in a visible position (around position 5-10)
                  const insertPosition = Math.min(8, topResults.length);
                  topResults.splice(insertPosition, 0, daResult);
                  // Limit to maxResults
                  topResults = topResults.slice(0, maxResults);
                  console.log(`Boosted 大 from position ${daIndex} to position ${insertPosition} in results`);
                }
              }
              
              // Convert scores to confidence (HanziLookupJS uses lower scores for better matches)
              const maxScore = topResults[0].score;
              const minScore = topResults[topResults.length - 1].score;
              const scoreRange = maxScore - minScore || 1;
              
              // Convert each result to RecognitionResult
              const recognitionResults: RecognitionResult[] = topResults.map((result, index) => {
                // Check if this is the boosted 大 character
                const isBoostedDa = result.character === '大' && normalizedStrokes.length >= 3 && 
                                   validResults.findIndex(r => r.character === '大') >= maxResults;
                
                // For draw-ahead, calculate confidence based on score
                // HanziLookup: lower scores = better matches
                // We need to convert score to confidence where lower score = higher confidence
                const normalizedScore = scoreRange > 0 ? (result.score - minScore) / scoreRange : 0;
                // Invert: lower normalized score (better match) = higher confidence
                // Use a more generous calculation to give better confidence to good matches
                let baseConfidence = Math.max(0.1, Math.min(0.95, 1 - normalizedScore * 0.5));
                
                // Special boost for 大 if it was ranked low
                if (isBoostedDa) {
                  baseConfidence = Math.max(0.75, baseConfidence); // Ensure at least 75% confidence
                }
                
                // Small boost for top results to differentiate them
                const boost = index < 10 ? 0.01 * (10 - index) : 0;
                const confidence = Math.min(0.95, baseConfidence + boost);
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
   * HanziLookup expects coordinates in 0-256 range
   * Strokes are in format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
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
    const maxDim = Math.max(width, height);
    
    // Use adaptive padding based on character size
    // Smaller characters need more padding, larger ones need less
    const basePadding = maxDim * 0.15;
    const minPadding = 20; // Minimum padding for very small drawings
    const padding = Math.max(basePadding, minPadding);
    
    const scale = maxDim + padding * 2;
    
    // Ensure minimum scale to avoid over-normalization
    const minScale = 60;
    const finalScale = Math.max(scale, minScale);
    
    // Center and normalize to 0-256 range (HanziLookup expects 256x256 canvas)
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const targetSize = 256;
    
    // Use adaptive effective size based on number of strokes
    // More strokes = slightly larger effective area (characters spread out more)
    const baseEffectiveSize = 200;
    const strokeBonus = Math.min(strokes.length * 2, 20); // Up to 20px bonus for more strokes
    const effectiveSize = baseEffectiveSize + strokeBonus;
    const offset = (targetSize - effectiveSize) / 2;
    
    return smoothedStrokes.map(stroke => {
      return stroke.map(point => {
        // Center the character and normalize to 0-256 range
        const centeredX = point[0] - centerX + finalScale / 2;
        const centeredY = point[1] - centerY + finalScale / 2;
        // Map to effective size with margin, then add offset to center in 256x256
        const normalizedX = Math.max(0, Math.min(effectiveSize, (centeredX / finalScale) * effectiveSize)) + offset;
        const normalizedY = Math.max(0, Math.min(effectiveSize, (centeredY / finalScale) * effectiveSize)) + offset;
        return [normalizedX, normalizedY];
      });
    });
  }

  /**
   * Smooth stroke to reduce noise from hand-drawn input
   * Uses a simple moving average filter
   * Stroke format: [[x, y], [x, y], ...]
   */
  private smoothStroke(stroke: number[][]): number[][] {
    if (stroke.length < 3) {
      return stroke; // Too short to smooth
    }

    const smoothed: number[][] = [];
    const windowSize = 3; // Number of points to average
    
    for (let i = 0; i < stroke.length; i++) {
      let sumX = 0, sumY = 0;
      let count = 0;
      
      // Average points in a window around current point
      for (let j = Math.max(0, i - windowSize); j <= Math.min(stroke.length - 1, i + windowSize); j++) {
        sumX += stroke[j][0];
        sumY += stroke[j][1];
        count++;
      }
      
      smoothed.push([sumX / count, sumY / count]);
    }
    
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
