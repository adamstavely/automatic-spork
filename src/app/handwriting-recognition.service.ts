import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, from, forkJoin, throwError } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { DictionaryService } from './dictionary.service';
import { StrokePreprocessingService } from './stroke-preprocessing.service';
import { TensorflowRecognitionService } from './tensorflow-recognition.service';
import { StrokeMatcherService } from './stroke-matcher.service';
import { ImageRecognitionService } from './image-recognition.service';
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
  
  // Option to bypass preprocessing for testing/comparison
  private usePreprocessing = true; // Can be toggled to test without preprocessing

  /**
   * Frequency boost data based on HSK (Hanyu Shuiping Kaoshi) frequency and common usage
   * Lower values = better (score is multiplied by this, so 0.70 = 30% boost)
   */
  private readonly COMMON_CHAR_FREQUENCY: { [char: string]: number } = {
    // Tier 1: Most common (HSK 1-2) - 30% boost
    '大': 0.70, '人': 0.70, '中': 0.70, '小': 0.70, '上': 0.70, '下': 0.70,
    '天': 0.70, '不': 0.70, '是': 0.70, '我': 0.70, '你': 0.70, '他': 0.70,
    '她': 0.70, '们': 0.70, '这': 0.70, '那': 0.70, '来': 0.70, '去': 0.70,
    '好': 0.70, '在': 0.70, '有': 0.70, '个': 0.70, '了': 0.70, '的': 0.70,
    '一': 0.70, '二': 0.70, '三': 0.70, '四': 0.70, '五': 0.70, '六': 0.70,
    '七': 0.70, '八': 0.70, '九': 0.70, '十': 0.70, '百': 0.70, '千': 0.70,
    '年': 0.70, '月': 0.70, '日': 0.70, '时': 0.70, '分': 0.70,
    '几': 0.70, '多': 0.70, '少': 0.70, '么': 0.70, '什': 0.70,
    '谁': 0.70, '哪': 0.70, '怎': 0.70, '为': 0.70,
    
    // Tier 2: Very common (HSK 2-3) - 20% boost
    '看': 0.80, '做': 0.80, '说': 0.80, '吃': 0.80, '喝': 0.80, '学': 0.80,
    '会': 0.80, '能': 0.80, '可': 0.80, '要': 0.80, '想': 0.80, '知': 0.80,
    '道': 0.80, '候': 0.80, '字': 0.80, '号': 0.80, '书': 0.80, '本': 0.80,
    '很': 0.80, '太': 0.80, '都': 0.80, '没': 0.80, '还': 0.80, '也': 0.80,
    '就': 0.80, '和': 0.80, '跟': 0.80, '与': 0.80, '给': 0.80, '被': 0.80,
    
    // Tier 3: Common (HSK 3-4) - 15% boost
    '生': 0.85, '活': 0.85, '工': 0.85, '作': 0.85, '问': 0.85, '题': 0.85,
    '事': 0.85, '情': 0.85, '意': 0.85, '思': 0.85, '觉': 0.85, '得': 0.85,
    '应': 0.85, '该': 0.85, '必': 0.85, '须': 0.85, '需': 0.85, '用': 0.85,
    '心': 0.85, '爱': 0.85, '喜': 0.85, '欢': 0.85, '高': 0.85, '兴': 0.85,
    '快': 0.85, '乐': 0.85, '开': 0.85, '关': 0.85, '始': 0.85, '结': 0.85,
    '束': 0.85, '完': 0.85, '成': 0.85, '帮': 0.85, '助': 0.85, '谢': 0.85,
    
    // Common family/people terms
    '妈': 0.75, '爸': 0.75, '哥': 0.75, '姐': 0.75, '弟': 0.75, '妹': 0.75,
    '子': 0.75, '女': 0.75, '男': 0.75, '老': 0.75, '师': 0.75, '友': 0.75,
    
    // Common location/direction
    '里': 0.75, '外': 0.75, '前': 0.75, '后': 0.75, '左': 0.75, '右': 0.75,
    '东': 0.75, '西': 0.75, '南': 0.75, '北': 0.75, '国': 0.75, '家': 0.75,
    
    // Common actions
    '走': 0.80, '跑': 0.80, '站': 0.80, '坐': 0.80, '睡': 0.80, '起': 0.80,
    '买': 0.80, '卖': 0.80, '玩': 0.80, '住': 0.80, '听': 0.80, '读': 0.80,
    '写': 0.80, '见': 0.80, '面': 0.80, '打': 0.80, '找': 0.80, '等': 0.80,
  };
  
  // Hybrid recognition configuration
  private readonly FUSION_WEIGHTS = {
    tensorflow: 0.5,      // α - TensorFlow.js weight
    strokeMatcher: 0.3,   // β - Stroke matcher weight
    imageRecognition: 0.2 // γ - Image-based OCR weight
  };

  constructor(
    private http: HttpClient,
    private dictionaryService: DictionaryService,
    private strokePreprocessingService: StrokePreprocessingService,
    private tensorflowService: TensorflowRecognitionService,
    private strokeMatcherService: StrokeMatcherService,
    private imageRecognitionService: ImageRecognitionService
  ) {
    // CACHE BUSTER v6: This log runs immediately when service is instantiated
    const VERSION = 'v6_' + Date.now();
    console.log('========================================');
    console.log('🚨🚨🚨 HANDWRITING RECOGNITION SERVICE LOADED v6 🚨🚨🚨', VERSION);
    console.log('🚨 HYBRID SYSTEM IS DISABLED - LEGACY ONLY 🚨');
    console.log('🚨 If you do NOT see this message, browser is using CACHED code! 🚨');
    console.log('========================================');
    console.error('CACHE BUSTER v6:', VERSION);
    alert('CACHE BUSTER: If you see this alert, new code is loaded! Version: ' + VERSION);
    
    // Wait for script to load before initializing (legacy - will be removed in Phase 6)
    this.waitForHanziLookupAndInit();
    this.buildCharacterDatabase();
  }

  /**
   * Enable or disable preprocessing
   * Set to false to bypass preprocessing and test recognition accuracy
   */
  setPreprocessingEnabled(enabled: boolean): void {
    this.usePreprocessing = enabled;
    console.log(`[Recognition] Preprocessing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if preprocessing is currently enabled
   */
  isPreprocessingEnabled(): boolean {
    return this.usePreprocessing;
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
      // First try hybrid approach (stroke-based + image-based) if strokes are provided
      if (strokes && strokes.length > 0) {
        return this.recognizeFromStrokes(strokes, canvas).pipe(
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
   * Fuse results from TensorFlow.js, stroke matcher, and image recognition
   * Combines results with weighted confidence scores
   */
  private fuseResults(
    tfResults: RecognitionResult[],
    strokeResults: RecognitionResult[],
    imageResults: RecognitionResult[],
    maxResults: number = 20
  ): RecognitionResult[] {
    // Create a map to combine results by character
    const resultMap = new Map<string, {
      character: string;
      tfConfidence: number;
      strokeConfidence: number;
      imageConfidence: number;
      fusedConfidence: number;
    }>();

    // Add TensorFlow results
    tfResults.forEach((result, index) => {
      if (result.character) {
        const normalizedConfidence = result.confidence || (1 - index * 0.05);
        resultMap.set(result.character, {
          character: result.character,
          tfConfidence: normalizedConfidence,
          strokeConfidence: 0,
          imageConfidence: 0,
          fusedConfidence: normalizedConfidence * this.FUSION_WEIGHTS.tensorflow
        });
      }
    });

    // Add stroke matcher results and combine
    strokeResults.forEach((result, index) => {
      if (result.character) {
        const normalizedConfidence = result.confidence || (1 - index * 0.05);
        const existing = resultMap.get(result.character);
        
        if (existing) {
          // Character found in multiple methods - combine confidences
          existing.strokeConfidence = normalizedConfidence;
          existing.fusedConfidence = 
            existing.tfConfidence * this.FUSION_WEIGHTS.tensorflow +
            normalizedConfidence * this.FUSION_WEIGHTS.strokeMatcher +
            existing.imageConfidence * this.FUSION_WEIGHTS.imageRecognition;
        } else {
          // Character only in stroke matcher
          resultMap.set(result.character, {
            character: result.character,
            tfConfidence: 0,
            strokeConfidence: normalizedConfidence,
            imageConfidence: 0,
            fusedConfidence: normalizedConfidence * this.FUSION_WEIGHTS.strokeMatcher
          });
        }
      }
    });

    // Add image recognition results and combine
    imageResults.forEach((result, index) => {
      if (result.character) {
        const normalizedConfidence = result.confidence || (1 - index * 0.05);
        const existing = resultMap.get(result.character);
        
        if (existing) {
          // Character found in multiple methods - combine confidences
          existing.imageConfidence = normalizedConfidence;
          existing.fusedConfidence = 
            existing.tfConfidence * this.FUSION_WEIGHTS.tensorflow +
            existing.strokeConfidence * this.FUSION_WEIGHTS.strokeMatcher +
            normalizedConfidence * this.FUSION_WEIGHTS.imageRecognition;
        } else {
          // Character only in image recognition
          resultMap.set(result.character, {
            character: result.character,
            tfConfidence: 0,
            strokeConfidence: 0,
            imageConfidence: normalizedConfidence,
            fusedConfidence: normalizedConfidence * this.FUSION_WEIGHTS.imageRecognition
          });
        }
      }
    });

    // No boosting - use raw fused confidence scores
    const boostedResults = Array.from(resultMap.values()).map(result => ({
      ...result,
      fusedConfidence: Math.min(1, result.fusedConfidence) // Cap at 1.0
    }));

    // Sort by fused confidence (descending)
    boostedResults.sort((a, b) => b.fusedConfidence - a.fusedConfidence);

    // Convert to RecognitionResult format
    const finalResults: RecognitionResult[] = boostedResults.slice(0, maxResults).map(result => ({
      character: result.character,
      confidence: Math.min(1, result.fusedConfidence),
      alternatives: []
    }));

    return finalResults;
  }

  /**
   * Hybrid recognition using TensorFlow.js, stroke matcher, and image recognition
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   * Canvas is optional - if provided, will use for image-based recognition
   */
  private recognizeHybrid(
    strokes: number[][][], 
    canvas?: HTMLCanvasElement,
    maxResults: number = 20
  ): Observable<RecognitionResult[]> {
    // Run all recognition methods in parallel
    const tfObservable = this.tensorflowService.recognize(strokes, maxResults * 2).pipe(
      timeout(3000), // 3 second timeout
      catchError(error => {
        console.warn('[Recognition] TensorFlow.js recognition failed:', error);
        return of([]);
      })
    );

    const strokeObservable = this.strokeMatcherService.match(strokes, maxResults * 2).pipe(
      timeout(5000), // 5 second timeout (increased to allow database to load)
      catchError(error => {
        console.warn('[Recognition] Stroke matcher failed:', error);
        return of([]);
      }),
      map(results => {
        if (results.length === 0) {
          console.warn('[Recognition] Stroke matcher returned no results for', strokes.length, 'strokes');
        }
        return results;
      })
    );

    // Image recognition (if canvas provided)
    const imageObservable = canvas 
      ? this.imageRecognitionService.recognizeFromCanvas(canvas, maxResults * 2).pipe(
          timeout(3000),
          catchError(error => {
            console.warn('[Recognition] Image recognition failed:', error);
            return of([]);
          })
        )
      : of([]);

    // Combine results and filter by dictionary
    return forkJoin({
      tf: tfObservable,
      stroke: strokeObservable,
      image: imageObservable
    }).pipe(
      switchMap(({ tf, stroke, image }) => {
        // Check dictionary but don't filter out - just mark which characters are in dictionary
        // This allows all characters through, but we can prioritize dictionary entries later if needed
        const checkDictionary = (results: RecognitionResult[]): Observable<RecognitionResult[]> => {
          if (results.length === 0) {
            return of([]);
          }

          // For now, just return all results without filtering
          // Characters not in dictionary will still be shown
          return of(results);
        };

        // Check all result sets (no filtering - show all characters)
        return forkJoin({
          tfFiltered: checkDictionary(tf),
          strokeFiltered: checkDictionary(stroke),
          imageFiltered: checkDictionary(image)
        }).pipe(
          switchMap(({ tfFiltered, strokeFiltered, imageFiltered }) => {
            // Log what each method found
            console.log('[Recognition] Results before fusion:', {
              tensorflow: tfFiltered.length > 0 ? `${tfFiltered.length} results, top: ${tfFiltered[0]?.character} (${((tfFiltered[0]?.confidence || 0) * 100).toFixed(1)}%)` : 'none',
              strokeMatcher: strokeFiltered.length > 0 ? `${strokeFiltered.length} results, top: ${strokeFiltered[0]?.character} (${((strokeFiltered[0]?.confidence || 0) * 100).toFixed(1)}%)` : 'none',
              imageRecognition: imageFiltered.length > 0 ? `${imageFiltered.length} results, top: ${imageFiltered[0]?.character} (${((imageFiltered[0]?.confidence || 0) * 100).toFixed(1)}%)` : 'none'
            });
            
            // If stroke matcher failed (no results), ALWAYS fall back to legacy
            // Stroke matcher is the most reliable method - if it fails, hybrid system isn't working
            if (strokeFiltered.length === 0) {
              console.warn('[Recognition] Stroke matcher returned no results, falling back to legacy HanziLookup');
              console.log('[Recognition] Condition check - strokeFiltered.length:', strokeFiltered.length, 'tfFiltered.length:', tfFiltered.length, 'imageFiltered.length:', imageFiltered.length);
              return throwError(() => new Error('Stroke matcher failed - using legacy'));
            }
            
            const fused = this.fuseResults(tfFiltered, strokeFiltered, imageFiltered, maxResults);
            
            console.log('[Recognition] After fusion, top 5:', fused.slice(0, 5).map(r => 
              `${r.character} (${(r.confidence * 100).toFixed(1)}%)`
            ));
            
            return of(fused);
          })
        );
      }),
      catchError(error => {
        console.error('[Recognition] Hybrid recognition error, falling back to legacy:', error);
        // Fallback to legacy HanziLookup which is more reliable
        return this.recognizeDrawAheadLegacy(strokes, maxResults);
      })
    );
  }

  /**
   * Check if HanziLookup is ready for recognition (legacy - will be removed)
   */
  isReady(): boolean {
    return this.hanzilookupReady && typeof HanziLookup !== 'undefined';
  }

  /**
   * Calculate optimal looseness parameter for matching
   * Based on stroke count, character complexity, and matching context
   */
  private calculateLooseness(strokeCount: number, isDrawAhead: boolean = false): number {
    // Stricter looseness values to prevent matching characters with very different stroke counts
    // Lower values = stricter matching, higher = more lenient
    const baseLooseness: { [key: number]: number } = {
      1: 0.12,   // Stricter
      2: 0.13,   // Stricter
      3: 0.14,   // Stricter - was 0.20, too lenient
      4: 0.14,   // Stricter
      5: 0.15,   // Stricter
      6: 0.15,   // Stricter
      7: 0.16,   // Stricter
      8: 0.16,   // Stricter
      9: 0.17,   // Stricter
      10: 0.17,  // Stricter
      11: 0.18,  // Stricter
      12: 0.18,  // Stricter
    };

    let looseness = baseLooseness[strokeCount] ?? 0.18;

    if (isDrawAhead) {
      looseness += 0.005;
    }

    return looseness;
  }

  /**
   * Client-side stroke-based recognition
   * Uses hybrid approach (TensorFlow.js + stroke matcher + image recognition) as primary method
   * Falls back to legacy HanziLookupJS if hybrid fails
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognizeFromStrokes(strokes: number[][][], canvas?: HTMLCanvasElement): Observable<RecognitionResult> {
    if (!strokes || strokes.length === 0) {
      return of({
        character: null,
        confidence: 0,
        alternatives: []
      });
    }

    // FORCE LEGACY SYSTEM - HYBRID DISABLED v6
    // If you see "Results before fusion" in console, browser is using CACHED CODE!
    console.log('========================================');
    console.log('🚨🚨🚨 recognizeFromStrokes: LEGACY SYSTEM FORCED v6 🚨🚨🚨');
    console.log('🚨 HYBRID SYSTEM IS DISABLED - USING LEGACY ONLY 🚨');
    console.log('If you see recognizeHybrid or "Results before fusion", BROWSER IS CACHED!');
    console.log('========================================');
    return this.recognizeFromStrokesLegacy(strokes);

    // DISABLED: Hybrid approach
    // return this.recognizeHybrid(strokes, canvas, 20).pipe(
    //   switchMap(results => {
    //     if (results && results.length > 0 && results[0].character && results[0].confidence > 0.3) {
    //       // Hybrid approach succeeded
    //       return of({
    //         character: results[0].character,
    //         confidence: results[0].confidence,
    //         alternatives: results.slice(1, 6).map(r => r.character).filter((c): c is string => c !== null)
    //       });
    //     }

    //     // Fallback to legacy HanziLookupJS if hybrid didn't produce good results
    //     console.log('[Recognition] Hybrid approach produced low confidence, trying legacy HanziLookup');
    //     return this.recognizeFromStrokesLegacy(strokes);
    //   }),
    //   catchError(error => {
    //     console.error('[Recognition] Hybrid recognition failed, using legacy fallback:', error);
    //     return this.recognizeFromStrokesLegacy(strokes);
    //   })
    // );
  }

  /**
   * Legacy HanziLookupJS recognition (will be removed in Phase 6)
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  private recognizeFromStrokesLegacy(strokes: number[][][]): Observable<RecognitionResult> {
    // Normalize and preprocess stroke data
    const normalizedStrokes = this.normalizeStrokes(strokes);
    
    // Try HanziLookupJS if available and ready
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
              
              // No boosting - use raw results directly
              const rawResults = validResults;
              
              console.log('Recognition (no boost):', {
                totalResults: rawResults.length,
                topResult: rawResults[0]?.character,
                topScore: rawResults[0]?.score?.toFixed(2),
                top10: rawResults.slice(0, 10).map(r => 
                  `${r.character}(${r.score.toFixed(2)})`
                )
              });
              
              // PHASE 2: Check if we should retry with multi-hypothesis
              const shouldRetry = this.shouldRetryWithMultiHypothesis(rawResults, strokes.length);
              
              if (shouldRetry) {
                console.log('⚠️ Low confidence detected, retrying with multi-hypothesis...');
                
                // Get preprocessed strokes for multi-hypothesis (bypass normalization's preprocessing)
                const preprocessedStrokes = this.usePreprocessing
                  ? this.strokePreprocessingService.preprocessStrokes(strokes)
                  : strokes;
                
                // Retry with multiple aspect ratios (enhanced version with 5 hypotheses)
                this.recognizeWithEnhancedHypotheses(preprocessedStrokes, looseness).subscribe({
                  next: (multiHypResults) => {
                    // No boosting - use raw multi-hypothesis results
                    const finalResults = multiHypResults;
                    
                    console.log('🎯 After multi-hypothesis (no boost):', {
                      topChar: finalResults[0]?.character,
                      topScore: finalResults[0]?.score?.toFixed(2),
                      bestHypothesis: multiHypResults[0]?.hypothesis
                    });
                    
                    // Use multi-hypothesis results
                    const bestResult = finalResults[0];
                    const confidence = this.calculateConfidence(finalResults, 0);
                    const alternatives = finalResults.slice(1, 11).map(r => r.character);
                    
                    observer.next({
                      character: bestResult.character,
                      confidence: confidence,
                      alternatives: alternatives
                    });
                    observer.complete();
                  },
                  error: (error) => {
                    console.error('Multi-hypothesis error, using standard results:', error);
                    // Fall back to standard results
                    const bestResult = rawResults[0];
                    const confidence = this.calculateConfidence(rawResults, 0);
                    const alternatives = rawResults.slice(1, 11).map(r => r.character);
                    
                    observer.next({
                      character: bestResult.character,
                      confidence: confidence,
                      alternatives: alternatives
                    });
                    observer.complete();
                  }
                });
                return; // Exit early, multi-hypothesis will complete the observer
              }
              
              // Fast path: Use standard results (no boosting)
              // Log top results
              console.log('Top 10 results (no boost):', rawResults.slice(0, 10).map((r, i) => `${i+1}. ${r.character} (${r.score.toFixed(2)})`).join(', '));
              
              // Convert scores to confidence
              // Use raw results for final selection
              const bestResult = rawResults[0];
              const confidence = this.calculateConfidence(rawResults, 0);
              
              // Get alternatives from raw results
              const alternatives = rawResults.slice(1, 11).map(r => r.character);
              
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
   * Uses hybrid approach (TensorFlow.js + stroke matcher + image recognition)
   * Returns array of RecognitionResult objects with top N matches
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognizeDrawAhead(strokes: number[][][], canvas?: HTMLCanvasElement, maxResults: number = 20): Observable<RecognitionResult[]> {
    if (!strokes || strokes.length === 0) {
      return of([]);
    }

    // FORCE LEGACY SYSTEM - HYBRID DISABLED v6
    // If you see "Results before fusion" in console, browser is using CACHED CODE!
    console.log('========================================');
    console.log('🚨🚨🚨 recognizeDrawAhead: LEGACY SYSTEM FORCED v6 🚨🚨🚨');
    console.log('🚨 HYBRID SYSTEM IS DISABLED - USING LEGACY ONLY 🚨');
    console.log('If you see "Results before fusion", BROWSER IS CACHED!');
    console.log('Using legacy HanziLookup for', strokes.length, 'strokes, maxResults:', maxResults);
    console.log('========================================');
    return this.recognizeDrawAheadLegacy(strokes, maxResults);

    // Use hybrid approach for draw-ahead recognition (includes image recognition if canvas provided)
    // return this.recognizeHybrid(strokes, canvas, maxResults).pipe(
    //   catchError(error => {
    //     console.warn('[Recognition] Hybrid draw-ahead failed, using legacy fallback:', error.message || error);
    //     console.log('[Recognition] Falling back to legacy HanziLookup for', strokes.length, 'strokes');
    //     return this.recognizeDrawAheadLegacy(strokes, maxResults);
    //   })
    // );
  }

  /**
   * Legacy HanziLookupJS draw-ahead recognition (will be removed in Phase 6)
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  private recognizeDrawAheadLegacy(strokes: number[][][], maxResults: number = 20): Observable<RecognitionResult[]> {
    // Normalize and preprocess stroke data
    const normalizedStrokes = this.normalizeStrokes(strokes);
    
    // Try HanziLookupJS if available and ready
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
            
            if (results && results.length > 0) {
              // Identify top 10 characters from unsorted results (before filtering/sorting)
              // These should be prioritized even if they have higher scores after sorting
              const top10Unsorted = results.slice(0, 10)
                .filter(r => r.score !== -Infinity && r.score !== Infinity && !isNaN(r.score) && isFinite(r.score))
                .map(r => r.character);
              const top10UnsortedSet = new Set(top10Unsorted);
              
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
              
              // Log top results AFTER sorting (this is the actual ranking)
              console.log(`Top 5 results (sorted by score, ascending):`, validResults.slice(0, 5).map((r, i) => 
                `${i+1}. ${r.character} (${r.score.toFixed(2)})`
              ).join(', '));
              
              // Check if any top 10 unsorted characters are in the sorted results
              const top10InSorted = top10Unsorted.filter(char => 
                validResults.some(r => r.character === char)
              );
              if (top10InSorted.length > 0) {
                console.log(`[Recognition] Top 10 unsorted characters found in results: ${top10InSorted.join(', ')}`);
              }
              
              // Log raw HanziLookup results (no boosting)
              const daIndex = validResults.findIndex(r => r.character === '大');
              const daResult = validResults.find(r => r.character === '大');
              console.log('[Recognition] Raw HanziLookup results (no boost):', {
                totalResults: validResults.length,
                top10: validResults.slice(0, 10).map((r, i) => `${i+1}. ${r.character} (${r.score.toFixed(2)})`),
                daIndex: daIndex !== -1 ? daIndex : 'NOT FOUND',
                daScore: daResult ? daResult.score.toFixed(2) : 'N/A',
                daRank: daIndex !== -1 ? `${daIndex + 1} of ${validResults.length}` : 'NOT IN RESULTS'
              });
              
              // No boosting - use raw results directly (HanziLookup already ranks by similarity)
              const rawResults = validResults;
              
              // Store top10UnsortedSet and top10Unsorted array for use later in prioritization
              (rawResults as any).__top10UnsortedSet = top10UnsortedSet;
              (rawResults as any).__top10Unsorted = top10Unsorted;
              
              console.log('Draw-ahead recognition (no boost):', {
                totalResults: rawResults.length,
                topResult: rawResults[0]?.character,
                topScore: rawResults[0]?.score?.toFixed(2),
                top10: rawResults.slice(0, 10).map(r => 
                  `${r.character}(${r.score.toFixed(2)})`
                )
              });
              
              // PHASE 2: Check if we should retry with multi-hypothesis (for draw-ahead, be more lenient)
              const shouldRetry = this.shouldRetryWithMultiHypothesis(rawResults, strokes.length);
              
              if (shouldRetry) {
                console.log('⚠️ Low confidence detected in draw-ahead, retrying with multi-hypothesis...');
                
                // Get preprocessed strokes for multi-hypothesis (bypass normalization's preprocessing)
                const preprocessedStrokes = this.usePreprocessing
                  ? this.strokePreprocessingService.preprocessStrokes(strokes)
                  : strokes;
                
                // Retry with multiple aspect ratios (enhanced version with 5 hypotheses)
                this.recognizeWithEnhancedHypotheses(preprocessedStrokes, looseness).subscribe({
                  next: (multiHypResults) => {
                    // No boosting - use raw multi-hypothesis results
                    const finalResults = multiHypResults;
                    
                    console.log('🎯 Draw-ahead after multi-hypothesis (no boost):', {
                      topChar: finalResults[0]?.character,
                      topScore: finalResults[0]?.score?.toFixed(2),
                      bestHypothesis: multiHypResults[0]?.hypothesis
                    });
                    
                    // Use multi-hypothesis results
                    const resultsToProcess = Math.max(maxResults, 200);
                    const topResults = finalResults.slice(0, resultsToProcess);
                    
                    // Convert each result to RecognitionResult with proper confidence calculation
                    const recognitionResults: RecognitionResult[] = topResults.map((result, index) => {
                      const confidence = this.calculateConfidence(finalResults, index);
                      return {
                        character: result.character,
                        confidence: confidence,
                        alternatives: [] // Empty for draw-ahead
                      };
                    });
                    
                    observer.next(recognitionResults);
                    observer.complete();
                  },
                  error: (error) => {
                    console.error('Multi-hypothesis error in draw-ahead, using standard results:', error);
                    // Fall back to standard results
                    const resultsToProcess = Math.max(maxResults, 200);
                    const topResults = rawResults.slice(0, resultsToProcess);
                    
                    const recognitionResults: RecognitionResult[] = topResults.map((result, index) => {
                      const confidence = this.calculateConfidence(rawResults, index);
                      return {
                        character: result.character,
                        confidence: confidence,
                        alternatives: []
                      };
                    });
                    
                    observer.next(recognitionResults);
                    observer.complete();
                  }
                });
                return; // Exit early, multi-hypothesis will complete the observer
              }
              
              // Fast path: Use standard results (no boosting)
              // Log top results
              console.log(`Top ${Math.min(10, maxResults)} results (no boost):`, rawResults.slice(0, Math.min(10, maxResults)).map((r, i) => `${i+1}. ${r.character} (${r.score.toFixed(2)})`).join(', '));
              
              // For draw-ahead, return top raw results
              // Prioritize characters that appeared in top 10 of unsorted results
              const resultsToProcess = Math.max(maxResults, 200); // Still get enough results for confidence calculation
              
              // Get the top 10 unsorted set and array that were stored earlier
              const storedTop10Set = (rawResults as any).__top10UnsortedSet as Set<string> | undefined;
              const storedTop10Array = (rawResults as any).__top10Unsorted as string[] | undefined;
              
              console.log('[Recognition] Prioritization check:', {
                hasStoredSet: !!storedTop10Set,
                storedSetSize: storedTop10Set?.size || 0,
                storedSetChars: storedTop10Set ? Array.from(storedTop10Set).slice(0, 5) : [],
                storedArray: storedTop10Array?.slice(0, 5) || [],
                rawResultsLength: rawResults.length
              });
              
              // Split results into two groups: top 10 from unsorted, and the rest
              const top10UnsortedResults: typeof rawResults = [];
              const otherResults: typeof rawResults = [];
              
              if (storedTop10Set && storedTop10Array) {
                for (const result of rawResults) {
                  if (storedTop10Set.has(result.character)) {
                    top10UnsortedResults.push(result);
                  } else {
                    otherResults.push(result);
                  }
                }
                // Sort top10UnsortedResults by their original order in the unsorted list
                top10UnsortedResults.sort((a, b) => {
                  const aIndex = storedTop10Array.indexOf(a.character);
                  const bIndex = storedTop10Array.indexOf(b.character);
                  return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
                });
              } else {
                // Fallback: if storedTop10Set not available, just use rawResults
                otherResults.push(...rawResults);
              }
              
              console.log('[Recognition] Prioritization result:', {
                top10UnsortedCount: top10UnsortedResults.length,
                top10UnsortedChars: top10UnsortedResults.map(r => r.character).slice(0, 5),
                otherResultsCount: otherResults.length
              });
              
              // Combine: top 10 from unsorted first, then the rest (both already sorted by score)
              const prioritizedResults = [...top10UnsortedResults, ...otherResults].slice(0, resultsToProcess);
              
              // Convert each result to RecognitionResult with proper confidence calculation
              const recognitionResults: RecognitionResult[] = prioritizedResults.map((result, index) => {
                // Use the original index in rawResults for confidence calculation
                const originalIndex = rawResults.findIndex(r => r.character === result.character);
                const confidence = originalIndex !== -1 ? this.calculateConfidence(rawResults, originalIndex) : this.calculateConfidence(prioritizedResults, index);
                return {
                  character: result.character,
                  confidence: confidence,
                  alternatives: [] // Empty for draw-ahead
                };
              });
              
              console.log('Draw-ahead results (prioritizing top 10 from unsorted):', recognitionResults.slice(0, 20).map((r, i) => `${i+1}. ${r.character} (score: ${prioritizedResults[i].score.toFixed(2)}, confidence: ${Math.round(r.confidence * 100)}%)`).join(', '));
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
   * Normalizes strokes to 256x256 canvas while preserving aspect ratio
   * Clean version without character-specific forced ratios
   * HanziLookup expects coordinates in 0-255 range (256x256 canvas)
   * Strokes are in format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  private normalizeStrokes(strokes: number[][][]): number[][][] {
    if (!strokes || strokes.length === 0) {
      return strokes;
    }

    // Optionally apply preprocessing pipeline: filter → smooth → simplify
    // This happens BEFORE normalization to improve recognition accuracy
    // Can be disabled for testing/comparison
    const strokesToNormalize = this.usePreprocessing
      ? this.strokePreprocessingService.preprocessStrokes(strokes)
      : (console.log('[Recognition] Preprocessing bypassed - using raw strokes'), strokes);
    
    const bounds = this.getBoundingBox(strokesToNormalize);
    const drawnWidth = bounds.maxX - bounds.minX;
    const drawnHeight = bounds.maxY - bounds.minY;
    const drawnAspectRatio = drawnWidth / drawnHeight;
    
    // Adaptive padding based on aspect ratio
    let paddingX: number;
    let paddingY: number;
    let fillRatio: number;
    
    if (drawnAspectRatio > 1.15) {
      paddingX = 15;
      paddingY = 25;
      fillRatio = 0.85;
    } else if (drawnAspectRatio < 0.7) {
      paddingX = 25;
      paddingY = 15;
      fillRatio = 0.85;
    } else {
      paddingX = 25;
      paddingY = 25;
      fillRatio = 0.70;
    }
    
    const availableWidth = 256 - (2 * paddingX);
    const availableHeight = 256 - (2 * paddingY);
    const targetWidth = availableWidth * fillRatio;
    const targetHeight = availableHeight * fillRatio;
    
    // Preserve aspect ratio
    let scale: number;
    
    if (drawnAspectRatio > 1) {
      scale = targetWidth / drawnWidth;
      const testHeight = drawnHeight * scale;
      if (testHeight > targetHeight) {
        scale = targetHeight / drawnHeight;
      }
    } else {
      scale = targetHeight / drawnHeight;
      const testWidth = drawnWidth * scale;
      if (testWidth > targetWidth) {
        scale = targetWidth / drawnWidth;
      }
    }
    
    scale = Math.max(0.3, Math.min(4.0, scale));
    
    const scaledWidth = drawnWidth * scale;
    const scaledHeight = drawnHeight * scale;
    const offsetX = paddingX + (availableWidth - scaledWidth) / 2;
    const offsetY = paddingY + (availableHeight - scaledHeight) / 2;
    
    return strokesToNormalize.map(stroke => 
      stroke.map(point => [
        (point[0] - bounds.minX) * scale + offsetX,
        (point[1] - bounds.minY) * scale + offsetY
      ])
    );
  }

  /**
   * Normalize strokes to a specific aspect ratio
   * Used by multi-hypothesis to test different proportions
   */
  private normalizeWithTargetAspect(strokes: number[][][], targetAspect: number): number[][][] {
    const bounds = this.getBoundingBox(strokes);
    const drawnWidth = bounds.maxX - bounds.minX;
    const drawnHeight = bounds.maxY - bounds.minY;
    
    const padding = 25;
    const availableSize = 256 - (2 * padding);
    
    let scaledWidth: number;
    let scaledHeight: number;
    
    if (targetAspect > 1) {
      // Wide: width is limiting dimension
      scaledWidth = availableSize * 0.85;
      scaledHeight = scaledWidth / targetAspect;
    } else {
      // Tall or square: height is limiting
      scaledHeight = availableSize * 0.85;
      scaledWidth = scaledHeight * targetAspect;
    }
    
    // Check bounds
    if (scaledHeight > availableSize * 0.85) {
      scaledHeight = availableSize * 0.85;
      scaledWidth = scaledHeight * targetAspect;
    }
    if (scaledWidth > availableSize * 0.85) {
      scaledWidth = availableSize * 0.85;
      scaledHeight = scaledWidth / targetAspect;
    }
    
    const scaleX = scaledWidth / drawnWidth;
    const scaleY = scaledHeight / drawnHeight;
    
    const offsetX = padding + (availableSize - scaledWidth) / 2;
    const offsetY = padding + (availableSize - scaledHeight) / 2;
    
    return strokes.map(stroke => 
      stroke.map(point => [
        (point[0] - bounds.minX) * scaleX + offsetX,
        (point[1] - bounds.minY) * scaleY + offsetY
      ])
    );
  }

  /**
   * Helper method to get bounding box of all strokes
   */
  private getBoundingBox(strokes: number[][][]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const stroke of strokes) {
      for (const point of stroke) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }
    
    return { minX, minY, maxX, maxY };
  }

  /**
   * Detect if character is 大-like (3 strokes: horizontal + 2 diagonals)
   */
  private isDaLikeCharacter(strokes: number[][][]): boolean {
    // Must be exactly 3 strokes
    if (strokes.length !== 3) {
      return false;
    }
    
    const [stroke1, stroke2, stroke3] = strokes;
    
    // Stroke 1: Should be horizontal
    const s1_isHorizontal = this.isHorizontalStroke(stroke1);
    if (!s1_isHorizontal) {
      return false;
    }
    
    // Strokes 2 & 3: Should be diagonal and going in opposite directions
    const s2_isDiagonal = this.isDiagonalStroke(stroke2);
    const s3_isDiagonal = this.isDiagonalStroke(stroke3);
    
    if (!s2_isDiagonal || !s3_isDiagonal) {
      return false;
    }
    
    // Check if diagonals go in opposite directions
    const s2_start = stroke2[0];
    const s2_end = stroke2[stroke2.length - 1];
    const s2_deltaX = s2_end[0] - s2_start[0];
    
    const s3_start = stroke3[0];
    const s3_end = stroke3[stroke3.length - 1];
    const s3_deltaX = s3_end[0] - s3_start[0];
    
    // One should go left (negative), one right (positive)
    const oppositeDirX = (s2_deltaX * s3_deltaX) < 0;
    
    // Both should go down (positive Y)
    const s2_deltaY = s2_end[1] - s2_start[1];
    const s3_deltaY = s3_end[1] - s3_start[1];
    const bothGoDown = s2_deltaY > 0 && s3_deltaY > 0;
    
    return oppositeDirX && bothGoDown;
  }

  /**
   * Check if a stroke is primarily horizontal
   */
  private isHorizontalStroke(stroke: number[][]): boolean {
    if (stroke.length < 2) return false;
    const start = stroke[0];
    const end = stroke[stroke.length - 1];
    const deltaX = Math.abs(end[0] - start[0]);
    const deltaY = Math.abs(end[1] - start[1]);
    return deltaX > deltaY * 2; // Horizontal if width > 2× height
  }

  /**
   * Check if a stroke is diagonal (not horizontal or vertical)
   */
  private isDiagonalStroke(stroke: number[][]): boolean {
    if (stroke.length < 2) return false;
    const start = stroke[0];
    const end = stroke[stroke.length - 1];
    const deltaX = Math.abs(end[0] - start[0]);
    const deltaY = Math.abs(end[1] - start[1]);
    if (deltaY === 0) return false; // Can't be diagonal if no vertical movement
    const ratio = deltaX / deltaY;
    return ratio > 0.3 && ratio < 3; // Diagonal if ratio between 0.3 and 3
  }

  /**
   * Optional: Add diagnostic method to visualize normalized vs original
   * Call this after normalization to see what's happening
   */
  private logStrokeGeometry(strokes: number[][][], label: string): void {
    console.log(`[${label}] Stroke Geometry:`);
    
    strokes.forEach((stroke, i) => {
      if (stroke.length < 2) return;
      
      const start = stroke[0];
      const end = stroke[stroke.length - 1];
      const deltaX = end[0] - start[0];
      const deltaY = end[1] - start[1];
      const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      
      console.log(`  Stroke ${i + 1}:`, {
        start: `(${start[0].toFixed(1)}, ${start[1].toFixed(1)})`,
        end: `(${end[0].toFixed(1)}, ${end[1].toFixed(1)})`,
        delta: `(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})`,
        length: length.toFixed(1),
        angle: angle.toFixed(1) + '°',
        points: stroke.length
      });
    });
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
   * Apply frequency boost to re-rank results based on character frequency
   * DISABLED: No boosting applied - returns results as-is
   */
  private applyFrequencyBoost(results: Array<{character: string, score: number}>): Array<{character: string, score: number, originalScore?: number, boosted?: boolean}> {
    // No boosting - return results unchanged
    return results.map(result => ({
      ...result,
      originalScore: result.score,
      score: result.score, // No boost applied
      boosted: false
    })).sort((a, b) => a.score - b.score); // Sort by original scores
  }

  /**
   * Run HanziLookup recognition with pre-normalized strokes
   * Returns Observable for integration with existing pipeline
   */
  private recognizeWithNormalizationObservable(
    normalizedStrokes: number[][][],
    looseness: number,
    hypothesisName: string,
    weight: number
  ): Observable<Array<{character: string, score: number, weightedScore: number, hypothesis: string}>> {
    return new Observable(observer => {
      if (typeof HanziLookup === 'undefined' || !this.hanzilookupReady) {
        observer.error(new Error('HanziLookup not ready'));
        return;
      }

      try {
        const analyzedChar = new HanziLookup.AnalyzedCharacter(normalizedStrokes);
        const matcher = new HanziLookup.Matcher('mmah', looseness);
        
        matcher.match(analyzedChar, 500, (results: Array<{character: string, score: number}>) => {
          const weighted = results.map(r => ({
            character: r.character,
            score: r.score,
            weightedScore: r.score * weight,
            hypothesis: hypothesisName
          }));
          observer.next(weighted);
          observer.complete();
        });
      } catch (error) {
        observer.error(error);
      }
    });
  }

  /**
   * Normalize strokes without preprocessing (for multi-hypothesis)
   */
  private normalizeStrokesWithoutPreprocessing(strokes: number[][][]): number[][][] {
    if (!strokes || strokes.length === 0) {
      return strokes;
    }
    
    const bounds = this.getBoundingBox(strokes);
    const drawnWidth = bounds.maxX - bounds.minX;
    const drawnHeight = bounds.maxY - bounds.minY;
    const drawnAspectRatio = drawnWidth / drawnHeight;
    
    // Adaptive padding based on aspect ratio
    let paddingX: number;
    let paddingY: number;
    let fillRatio: number;
    
    if (drawnAspectRatio > 1.15) {
      paddingX = 15;
      paddingY = 25;
      fillRatio = 0.85;
    } else if (drawnAspectRatio < 0.7) {
      paddingX = 25;
      paddingY = 15;
      fillRatio = 0.85;
    } else {
      paddingX = 25;
      paddingY = 25;
      fillRatio = 0.70;
    }
    
    const availableWidth = 256 - (2 * paddingX);
    const availableHeight = 256 - (2 * paddingY);
    const targetWidth = availableWidth * fillRatio;
    const targetHeight = availableHeight * fillRatio;
    
    // Preserve aspect ratio
    let scale: number;
    
    if (drawnAspectRatio > 1) {
      scale = targetWidth / drawnWidth;
      const testHeight = drawnHeight * scale;
      if (testHeight > targetHeight) {
        scale = targetHeight / drawnHeight;
      }
    } else {
      scale = targetHeight / drawnHeight;
      const testWidth = drawnWidth * scale;
      if (testWidth > targetWidth) {
        scale = targetWidth / drawnWidth;
      }
    }
    
    scale = Math.max(0.3, Math.min(4.0, scale));
    
    const scaledWidth = drawnWidth * scale;
    const scaledHeight = drawnHeight * scale;
    const offsetX = paddingX + (availableWidth - scaledWidth) / 2;
    const offsetY = paddingY + (availableHeight - scaledHeight) / 2;
    
    return strokes.map(stroke => 
      stroke.map(point => [
        (point[0] - bounds.minX) * scale + offsetX,
        (point[1] - bounds.minY) * scale + offsetY
      ])
    );
  }

  /**
   * Test multiple aspect ratios and return best results
   * Based on diagnostic: 1.47:1 works best, but also test 1.5:1 and 1.2:1
   * Note: strokes should already be preprocessed before calling this
   */
  private recognizeWithMultipleHypotheses(
    preprocessedStrokes: number[][][],
    looseness: number
  ): Observable<Array<{character: string, score: number, originalScore?: number, hypothesis?: string}>> {
    console.log('🔬 Running multi-hypothesis recognition for better accuracy...');
    
    // Test 3 different normalizations based on diagnostic results
    // Use normalizeStrokesWithoutPreprocessing to avoid double preprocessing
    const hypotheses = [
      {
        name: 'preserve',
        strokes: this.normalizeStrokesWithoutPreprocessing(preprocessedStrokes),
        weight: 1.0,
        description: 'Aspect-preserving'
      },
      {
        name: 'wide-1.5',
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.5),
        weight: 0.95,
        description: 'Wide 1.5:1 (optimal for 大)'
      },
      {
        name: 'wide-1.2',
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.2),
        weight: 0.92,
        description: 'Balanced 1.2:1'
      }
    ];
    
    // Run recognition on each hypothesis in parallel
    const observables = hypotheses.map(hyp => 
      this.recognizeWithNormalizationObservable(hyp.strokes, looseness, hyp.name, hyp.weight)
    );
    
    return forkJoin(observables).pipe(
      map((allResults: Array<Array<{character: string, score: number, weightedScore: number, hypothesis: string}>>) => {
        // Flatten all results
        const flatResults = allResults.flat();
        
        // Deduplicate: for each character, keep the best score across all hypotheses
        const charMap = new Map<string, {score: number, hypothesis: string, originalScore: number}>();
        
        flatResults.forEach((r: {character: string, score: number, weightedScore: number, hypothesis: string}) => {
          const existing = charMap.get(r.character);
          if (!existing || r.weightedScore < existing.score) {
            charMap.set(r.character, {
              score: r.weightedScore,
              hypothesis: r.hypothesis,
              originalScore: r.score
            });
          }
        });
        
        // Convert back to array and sort
        const finalResults = Array.from(charMap.entries()).map(([char, data]) => ({
          character: char,
          score: data.score,
          originalScore: data.originalScore,
          hypothesis: data.hypothesis
        }));
        
        finalResults.sort((a, b) => a.score - b.score);
        
        console.log('✅ Multi-hypothesis complete:', {
          topChar: finalResults[0]?.character,
          topScore: finalResults[0]?.score?.toFixed(2),
          bestHypothesis: finalResults[0]?.hypothesis,
          top10: finalResults.slice(0, 10).map(r => `${r.character}(${r.hypothesis}:${r.score.toFixed(2)})`)
        });
        
        return finalResults;
      })
    );
  }

  /**
   * Enhanced multi-hypothesis with 5 aspect ratios including 1.47:1 (diagnostic winner)
   * Tests more variations for highest accuracy (takes ~250ms but highest accuracy)
   * 
   * TO USE ENHANCED VERSION:
   * Replace recognizeWithMultipleHypotheses() calls with recognizeWithEnhancedHypotheses()
   */
  private recognizeWithEnhancedHypotheses(
    preprocessedStrokes: number[][][],
    looseness: number
  ): Observable<Array<{character: string, score: number, originalScore?: number, hypothesis?: string}>> {
    console.log('🔬🔬 Running ENHANCED multi-hypothesis with 5 variations...');
    
    const hypotheses = [
      { 
        name: 'preserve', 
        strokes: this.normalizeStrokesWithoutPreprocessing(preprocessedStrokes), 
        weight: 1.0 
      },
      { 
        name: 'optimal-1.47', 
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.47), 
        weight: 0.98 
      }, // Diagnostic winner
      { 
        name: 'wide-1.5', 
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.5), 
        weight: 0.95 
      },
      { 
        name: 'balanced-1.2', 
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.2), 
        weight: 0.92 
      },
      { 
        name: 'square-1.0', 
        strokes: this.normalizeWithTargetAspect(preprocessedStrokes, 1.0), 
        weight: 0.88 
      }
    ];
    
    // Run recognition on each hypothesis in parallel
    const observables = hypotheses.map(hyp => 
      this.recognizeWithNormalizationObservable(hyp.strokes, looseness, hyp.name, hyp.weight)
    );
    
    return forkJoin(observables).pipe(
      map((allResults: Array<Array<{character: string, score: number, weightedScore: number, hypothesis: string}>>) => {
        // Flatten all results
        const flatResults = allResults.flat();
        
        // Deduplicate: for each character, keep the best score across all hypotheses
        const charMap = new Map<string, {score: number, hypothesis: string, originalScore: number}>();
        
        flatResults.forEach((r: {character: string, score: number, weightedScore: number, hypothesis: string}) => {
          const existing = charMap.get(r.character);
          if (!existing || r.weightedScore < existing.score) {
            charMap.set(r.character, {
              score: r.weightedScore,
              hypothesis: r.hypothesis,
              originalScore: r.score
            });
          }
        });
        
        // Convert back to array and sort
        const finalResults = Array.from(charMap.entries()).map(([char, data]) => ({
          character: char,
          score: data.score,
          originalScore: data.originalScore,
          hypothesis: data.hypothesis
        }));
        
        finalResults.sort((a, b) => a.score - b.score);
        
        console.log('✅✅ Enhanced multi-hypothesis complete:', {
          topChar: finalResults[0]?.character,
          topScore: finalResults[0]?.score?.toFixed(2),
          bestHypothesis: finalResults[0]?.hypothesis,
          top5: finalResults.slice(0, 5).map(r => `${r.character}(${r.hypothesis})`)
        });
        
        return finalResults;
      })
    );
  }

  /**
   * Decide if we should retry with multi-hypothesis
   * 
   * Criteria:
   * 1. Must be 3-stroke character (where 大 lives)
   * 2. Top result has poor confidence (score > 1.8 after frequency boost)
   */
  private shouldRetryWithMultiHypothesis(results: any[], strokeCount: number): boolean {
    // Only for 3-stroke characters
    if (strokeCount !== 3) {
      return false;
    }
    
    // Must have results
    if (results.length === 0) {
      return true; // If no results, definitely retry
    }
    
    // Check top result confidence
    const topScore = results[0].score;
    
    // If top score is poor (>1.8 after boost), retry
    // Note: Lower score = better match in HanziLookup
    const CONFIDENCE_THRESHOLD = 1.8;
    
    if (topScore > CONFIDENCE_THRESHOLD) {
      console.log(`📊 Top score ${topScore.toFixed(2)} exceeds threshold ${CONFIDENCE_THRESHOLD}, will retry`);
      return true;
    }
    
    return false;
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

  // ============================================================================
  // DIAGNOSTIC METHODS: Test Multiple 大 Variants Against Database
  // ============================================================================

  /**
   * Test different 大 proportions to find which matches database best
   * Call this from ngOnInit or add a diagnostic button
   */
  public testDaVariants(): void {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         TESTING 大 VARIANTS AGAINST DATABASE               ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // Create different proportions of 大
    const variants = [
      {
        name: 'Wide Sprawling (2:1 aspect)',
        description: 'Very wide horizontal, diagonals spread far',
        strokes: [
          [[40, 80], [216, 80]],       // Wide horizontal (176px)
          [[128, 80], [40, 200]],      // Left diagonal: 88px left, 120px down
          [[128, 80], [216, 200]]      // Right diagonal: 88px right, 120px down
        ]
      },
      {
        name: 'Medium Wide (1.5:1 aspect)',
        description: 'Moderately wide, balanced spread',
        strokes: [
          [[60, 80], [196, 80]],       // Medium horizontal (136px)
          [[128, 80], [60, 200]],      // Left diagonal: 68px left, 120px down
          [[128, 80], [196, 200]]      // Right diagonal: 68px right, 120px down
        ]
      },
      {
        name: 'Balanced (1.25:1 aspect)',
        description: 'Slightly wider than tall, typical handwriting',
        strokes: [
          [[70, 80], [186, 80]],       // Balanced horizontal (116px)
          [[128, 80], [70, 176]],      // Left diagonal: 58px left, 96px down
          [[128, 80], [186, 176]]      // Right diagonal: 58px right, 96px down
        ]
      },
      {
        name: 'Narrow (1:1 aspect)',
        description: 'Square proportions',
        strokes: [
          [[88, 80], [168, 80]],       // Narrow horizontal (80px)
          [[128, 80], [88, 200]],      // Left diagonal: 40px left, 120px down
          [[128, 80], [168, 200]]      // Right diagonal: 40px right, 120px down
        ]
      },
      {
        name: 'Tall (1:1.5 aspect)',
        description: 'Taller than wide, steep diagonals',
        strokes: [
          [[80, 60], [176, 60]],       // Short horizontal (96px)
          [[128, 60], [90, 220]],      // Left diagonal: 38px left, 160px down
          [[128, 60], [166, 220]]      // Right diagonal: 38px right, 160px down
        ]
      },
      {
        name: 'Your Recent Draw',
        description: 'Based on your last attempt (aspect 1.7:1)',
        strokes: [
          [[44, 80], [221, 80]],       // Your horizontal (177px)
          [[128, 80], [54, 180]],      // Your left diagonal: 74px left, 100px down
          [[128, 80], [202, 180]]      // Your right diagonal: 74px right, 100px down
        ]
      }
    ];
    
    const results: any[] = [];
    let completedTests = 0;
    
    // Test each variant
    variants.forEach((variant, index) => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`VARIANT ${index + 1}: ${variant.name}`);
      console.log(`${variant.description}`);
      console.log(`${'='.repeat(60)}`);
      
      // Calculate original proportions
      const bounds = this.getBoundingBox(variant.strokes);
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      const aspectRatio = width / height;
      
      console.log(`\nOriginal proportions:`);
      console.log(`  Width: ${width.toFixed(1)}px`);
      console.log(`  Height: ${height.toFixed(1)}px`);
      console.log(`  Aspect ratio: ${aspectRatio.toFixed(2)}:1`);
      
      // Normalize using current algorithm
      const normalized = this.normalizeStrokes(variant.strokes);
      
      // Log normalized geometry
      this.logStrokeGeometry(normalized, `Normalized ${variant.name}`);
      
      // Test with HanziLookup
      if (typeof HanziLookup !== 'undefined' && this.hanzilookupReady) {
        try {
          const analyzedChar = new HanziLookup.AnalyzedCharacter(normalized);
          const looseness = 0.175; // Use current looseness for 3-stroke
          const matcher = new HanziLookup.Matcher('mmah', looseness);
          
          matcher.match(analyzedChar, 500, (matchResults: Array<{character: string, score: number}>) => {
            // Filter valid results and sort by score (lower = better)
            const validResults = matchResults.filter(r => 
              r.score !== -Infinity && 
              r.score !== Infinity && 
              !isNaN(r.score) &&
              isFinite(r.score)
            );
            
            // Sort by score ascending (lower score = better match)
            validResults.sort((a, b) => a.score - b.score);
            
            // Find 大 in sorted results
            const daResult = validResults.find((r: any) => r.character === '大');
            const daRank = daResult ? validResults.indexOf(daResult) + 1 : -1;
            const daScore = daResult ? daResult.score : 'N/A';
            
            console.log(`\n📊 RESULTS:`);
            console.log(`  大 rank: ${daRank === -1 ? 'NOT FOUND' : `${daRank} of ${validResults.length}`}`);
            console.log(`  大 score: ${typeof daScore === 'number' ? daScore.toFixed(2) : daScore}`);
            console.log(`  Top 5 matches: ${validResults.slice(0, 5).map((r: any) => `${r.character}(${r.score.toFixed(2)})`).join(', ')}`);
            
            // Store result with variant index to maintain order
            const result = {
              variant: variant.name,
              rank: daRank,
              score: daScore,
              aspectRatio: aspectRatio,
              top5: validResults.slice(0, 5).map((r: any) => r.character).join(', '),
              variantIndex: index // Store index to maintain order
            };
            
            results.push(result);
            
            completedTests++;
            
            console.log(`\nProgress: ${completedTests}/${variants.length} tests completed`);
            
            // Print summary after all tests complete
            if (completedTests === variants.length) {
              // Sort results by variant index to maintain original order
              results.sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
              this.printDiagnosticSummary(results);
            }
          });
        } catch (error) {
          console.error(`Error testing variant ${variant.name}:`, error);
          results.push({
            variant: variant.name,
            rank: -1,
            score: 'ERROR',
            aspectRatio: aspectRatio,
            top5: 'N/A',
            variantIndex: index
          });
          completedTests++;
          console.log(`\nProgress: ${completedTests}/${variants.length} tests completed`);
          if (completedTests === variants.length) {
            results.sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
            this.printDiagnosticSummary(results);
          }
        }
      } else {
        console.warn('HanziLookup not ready');
        results.push({
          variant: variant.name,
          rank: -1,
          score: 'NOT READY',
          aspectRatio: aspectRatio,
          top5: 'N/A',
          variantIndex: index
        });
        completedTests++;
        console.log(`\nProgress: ${completedTests}/${variants.length} tests completed`);
        if (completedTests === variants.length) {
          results.sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
          this.printDiagnosticSummary(results);
        }
      }
    });
  }

  /**
   * Print summary of diagnostic results
   */
  private printDiagnosticSummary(results: any[]): void {
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    DIAGNOSTIC SUMMARY                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // Check if we have any results
    if (results.length === 0) {
      console.log('❌ No test results available!');
      return;
    }
    
    // Sort by rank (best first), but keep those with rank -1 at the end
    const withRank = results.filter(r => r.rank !== -1);
    const withoutRank = results.filter(r => r.rank === -1);
    const sorted = [...withRank.sort((a, b) => a.rank - b.rank), ...withoutRank];
    
    if (withRank.length === 0) {
      console.log('❌ 大 was NOT FOUND in any variant!');
      console.log('   This suggests a fundamental database incompatibility.');
      console.log('\n📋 All variants tested:\n');
      results.forEach((result, i) => {
        console.log(`   ${i + 1}. ${result.variant} (aspect: ${result.aspectRatio.toFixed(2)}:1) - NOT FOUND`);
      });
      return;
    }
    
    console.log('📈 Results ranked by 大 performance:\n');
    console.log('Rank | Variant                    | 大 Rank | Score | Aspect | Top 5 Matches');
    console.log('-----|----------------------------|---------|-------|--------|------------------');
    
    sorted.forEach((result, i) => {
      const rank = String(i + 1).padStart(4);
      const variant = result.variant.padEnd(26);
      const daRank = result.rank === -1 ? 'NOT FOUND'.padStart(7) : String(result.rank).padStart(7);
      const score = typeof result.score === 'number' ? result.score.toFixed(2) : (result.score || 'N/A');
      const scoreStr = String(score).padStart(5);
      const aspect = result.aspectRatio ? result.aspectRatio.toFixed(2).padStart(6) : 'N/A'.padStart(6);
      const top5 = result.top5 || 'N/A';
      
      console.log(`${rank} | ${variant} | ${daRank} | ${scoreStr} | ${aspect} | ${top5}`);
    });
    
    // Find best variant
    const best = sorted[0];
    console.log('\n\n🏆 WINNER:');
    console.log(`   ${best.variant}`);
    console.log(`   大 ranked: #${best.rank}`);
    console.log(`   Score: ${typeof best.score === 'number' ? best.score.toFixed(2) : best.score}`);
    console.log(`   Aspect ratio: ${best.aspectRatio.toFixed(2)}:1`);
    
    // Recommendations
    console.log('\n\n💡 RECOMMENDATIONS:\n');
    
    if (best.rank <= 20) {
      console.log('✅ Good news! A variant ranks in top 20.');
      console.log(`   Target aspect ratio: ${best.aspectRatio.toFixed(2)}:1`);
      console.log('   Action: Adjust normalization to force this aspect ratio for 大-like characters');
    } else if (best.rank <= 50) {
      console.log(`⚠️  Best variant ranks ${best.rank}th - marginal.`);
      console.log('   Options:');
      console.log('   1. Force aspect ratio + increase looseness to 0.20+');
      console.log('   2. Add post-processing boost for 大');
      console.log('   3. Consider alternative recognition library');
    } else {
      console.log(`❌ Even best variant ranks poorly (${best.rank}th).`);
      console.log('   This suggests database incompatibility.');
      console.log('   Recommended: Add post-processing boost or use different database');
    }
    
    // Compare with user's drawing
    const userVariant = results.find(r => r.variant === 'Your Recent Draw');
    if (userVariant && userVariant.rank !== -1) {
      console.log(`\n   Your drawing ranked: #${userVariant.rank}`);
      if (userVariant.rank > best.rank) {
        const diff = userVariant.rank - best.rank;
        console.log(`   Gap from best: ${diff} positions`);
        console.log(`   Your aspect (${userVariant.aspectRatio.toFixed(2)}:1) vs best (${best.aspectRatio.toFixed(2)}:1)`);
      }
    }
    
    console.log('\n');
  }

  /**
   * Simpler test - just log what current normalization does to ideal 大
   */
  public quickDiagnostic(): void {
    console.log('\n=== QUICK DIAGNOSTIC: Ideal 大 ===\n');
    
    // Perfect 大 proportions
    const idealDa: number[][][] = [
      [[70, 80], [186, 80]],      // Horizontal
      [[128, 80], [70, 176]],     // Left diagonal
      [[128, 80], [186, 176]]      // Right diagonal
    ];
    
    console.log('Input (ideal 大):');
    console.log('  Horizontal: 70→186 (116px wide)');
    console.log('  Left diagonal: 128→70 (58px left), 80→176 (96px down)');
    console.log('  Right diagonal: 128→186 (58px right), 80→176 (96px down)');
    console.log('  Aspect ratio: 1.21:1');
    
    const normalized = this.normalizeStrokes(idealDa);
    
    console.log('\nAfter normalization:');
    this.logStrokeGeometry(normalized, 'Normalized Ideal 大');
    
    // Test it
    if (typeof HanziLookup !== 'undefined' && this.hanzilookupReady) {
      try {
        const analyzedChar = new HanziLookup.AnalyzedCharacter(normalized);
        const looseness = 0.175;
        const matcher = new HanziLookup.Matcher('mmah', looseness);
        
        matcher.match(analyzedChar, 500, (results: Array<{character: string, score: number}>) => {
          const daResult = results.find((r: any) => r.character === '大');
          const daRank = daResult ? results.indexOf(daResult) + 1 : -1;
          
          console.log('\nMatching result:');
          console.log(`  大 rank: ${daRank === -1 ? 'NOT FOUND' : daRank}`);
          console.log(`  大 score: ${daResult ? daResult.score.toFixed(2) : 'N/A'}`);
          console.log(`  Top 10: ${results.slice(0, 10).map((r: any) => r.character).join(' ')}`);
          
          if (daRank === -1 || daRank > 20) {
            console.log('\n❌ Even ideal proportions fail! Database issue confirmed.');
          } else {
            console.log('\n✅ Ideal proportions work! Problem is in user drawing or normalization.');
          }
        });
      } catch (error) {
        console.error('Error in quick diagnostic:', error);
      }
    } else {
      console.warn('HanziLookup not ready');
    }
  }
}
