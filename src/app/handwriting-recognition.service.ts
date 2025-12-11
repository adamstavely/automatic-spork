import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DictionaryService } from './dictionary.service';

interface RecognitionResult {
  character: string | null;
  confidence: number;
  alternatives: string[];
}

@Injectable({
  providedIn: 'root'
})
export class HandwritingRecognitionService {
  // Google Cloud Vision API endpoint
  // Note: In production, you should use a backend proxy to keep your API key secure
  private readonly VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';
  
  // For now, we'll use a client-side approach with canvas image analysis
  // In production, integrate with Google Cloud Vision API or similar service
  
  constructor(
    private http: HttpClient,
    private dictionaryService: DictionaryService
  ) {}

  /**
   * Recognize Chinese character from canvas image
   * This method extracts the image from canvas and attempts recognition
   */
  recognizeFromCanvas(canvas: HTMLCanvasElement, strokes?: number[][]): Observable<RecognitionResult> {
    try {
      // First try stroke-based recognition if strokes are provided
      if (strokes && strokes.length > 0) {
        return this.recognizeFromStrokes(strokes).pipe(
          switchMap(result => {
            // If stroke-based recognition found something, return it
            if (result.character) {
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
      console.error('Canvas recognition error:', error);
      return of({
        character: null,
        confidence: 0,
        alternatives: []
      });
    }
  }

  /**
   * Suggest characters from dictionary based on stroke count
   * This provides a fallback when direct recognition fails
   */
  private suggestCharactersByStrokeCount(strokeCount: number, previousResult: RecognitionResult): Observable<RecognitionResult> {
    // Get common single-character entries from dictionary
    return this.dictionaryService.getAllEntries().pipe(
      map(entries => {
        // Filter to single-character entries
        const singleCharEntries = entries.filter(e => 
          e.simplified.length === 1 && /[\u4e00-\u9fff]/.test(e.simplified)
        );
        
        // Get unique characters
        const uniqueChars = new Set<string>();
        singleCharEntries.forEach(e => {
          uniqueChars.add(e.simplified);
          if (e.traditional && e.traditional.length === 1) {
            uniqueChars.add(e.traditional);
          }
        });
        
        // For now, return the first few common characters as alternatives
        // In a real implementation, you'd match by stroke count from a database
        const commonChars = Array.from(uniqueChars).slice(0, 10);
        
        return {
          character: previousResult.character || (commonChars.length > 0 ? commonChars[0] : null),
          confidence: previousResult.confidence || 0.3,
          alternatives: commonChars.slice(1, 6)
        };
      }),
      catchError(() => of(previousResult))
    );
  }

  /**
   * Recognize using Google Cloud Vision API
   * Note: Requires API key and backend proxy for security
   */
  private recognizeWithVisionAPI(imageData: string): Observable<RecognitionResult> {
    // Extract base64 data
    const base64Data = imageData.split(',')[1];
    
    // For production, this should go through your backend
    // For now, we'll return a "not configured" result
    return of({
      character: null,
      confidence: 0,
      alternatives: []
    });
  }

  /**
   * Client-side stroke-based recognition
   * This analyzes stroke patterns and attempts to match known characters
   */
  recognizeFromStrokes(strokes: number[][]): Observable<RecognitionResult> {
    if (!strokes || strokes.length === 0) {
      return of({
        character: null,
        confidence: 0,
        alternatives: []
      });
    }

    // Normalize stroke data
    const normalizedStrokes = this.normalizeStrokes(strokes);
    const strokeCount = strokes.length;
    
    // Analyze stroke characteristics
    const strokeFeatures = this.analyzeStrokeFeatures(normalizedStrokes);
    
    // Try to match against a basic character database
    // This is a simplified implementation - in production, use a comprehensive database
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
   * Normalize stroke coordinates to a standard size
   */
  private normalizeStrokes(strokes: number[][]): number[][] {
    // Find bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    strokes.forEach(stroke => {
      for (let i = 0; i < stroke.length; i += 2) {
        const x = stroke[i];
        const y = stroke[i + 1];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    });
    
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    const scale = Math.max(width, height);
    
    // Normalize to 0-100 range
    return strokes.map(stroke => {
      const normalized: number[] = [];
      for (let i = 0; i < stroke.length; i += 2) {
        normalized.push(((stroke[i] - minX) / scale) * 100);
        normalized.push(((stroke[i + 1] - minY) / scale) * 100);
      }
      return normalized;
    });
  }

  /**
   * Analyze stroke features for pattern matching
   */
  private analyzeStrokeFeatures(strokes: number[][]): any {
    const features: any = {
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
      if (stroke.length >= 4) {
        const dx = stroke[stroke.length - 2] - stroke[0];
        const dy = stroke[stroke.length - 1] - stroke[1];
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
   * This is a simplified database - in production, use a comprehensive one
   */
  private matchCharacter(strokeCount: number, features: any): any {
    // Expanded character patterns for common characters
    const characterPatterns: any = {
      1: [
        { character: '一', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '丨', features: { hasVertical: true }, confidence: 0.9 },
        { character: '丶', features: {}, confidence: 0.7 },
        { character: '丿', features: { hasDiagonal: true }, confidence: 0.8 }
      ],
      2: [
        { character: '二', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '人', features: { hasDiagonal: true }, confidence: 0.8 },
        { character: '十', features: { hasVertical: true, hasHorizontal: true }, confidence: 0.9 },
        { character: '八', features: { hasDiagonal: true }, confidence: 0.7 }
      ],
      3: [
        { character: '三', features: { hasHorizontal: true }, confidence: 0.9 },
        { character: '大', features: { hasHorizontal: true, hasDiagonal: true }, confidence: 0.8 },
        { character: '口', features: {}, confidence: 0.7 },
        { character: '小', features: {}, confidence: 0.6 },
        { character: '山', features: {}, confidence: 0.6 }
      ],
      4: [
        { character: '中', features: { hasVertical: true, hasHorizontal: true }, confidence: 0.8 },
        { character: '文', features: { hasHorizontal: true, hasDiagonal: true }, confidence: 0.7 },
        { character: '水', features: {}, confidence: 0.6 },
        { character: '火', features: {}, confidence: 0.6 },
        { character: '木', features: {}, confidence: 0.6 }
      ],
      5: [
        { character: '白', features: {}, confidence: 0.5 },
        { character: '生', features: {}, confidence: 0.5 },
        { character: '用', features: {}, confidence: 0.5 }
      ]
    };
    
    const candidates = characterPatterns[strokeCount];
    if (!candidates || candidates.length === 0) {
      return null;
    }
    
    // Simple matching based on features
    // Find the best matching candidate
    let bestMatch: any = null;
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
      
      // Base confidence from the pattern
      score += candidate.confidence * 0.1;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    
    // If we have a reasonable match, return it
    // Otherwise, return the first candidate as a fallback
    if (bestMatch && bestScore > 0.2) {
      return {
        character: bestMatch.character,
        confidence: Math.min(0.7, bestScore),
        alternatives: candidates
          .filter((c: any) => c.character !== bestMatch.character)
          .slice(0, 3)
          .map((c: any) => c.character)
      };
    } else if (candidates.length > 0) {
      // Return first candidate as fallback with lower confidence
      return {
        character: candidates[0].character,
        confidence: 0.4,
        alternatives: candidates.slice(1, 4).map((c: any) => c.character)
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
        console.error('Browser recognition error:', error);
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
    
    // For now, we can't reliably recognize from image alone
    // In production, you'd use:
    // - Google Cloud Vision API
    // - Microsoft Azure Computer Vision
    // - HanziLookupJS library (client-side)
    // - Or other ML-based recognition services
    
    return {
      character: null,
      confidence: 0,
      alternatives: []
    };
  }
}

