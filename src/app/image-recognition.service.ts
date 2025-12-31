import { Injectable } from '@angular/core';
import { Observable, of, from, firstValueFrom } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DictionaryService } from './dictionary.service';
import { RecognitionResult } from './types/handwriting.types';

@Injectable({
  providedIn: 'root'
})
export class ImageRecognitionService {
  // Character template database (will be built from reference images)
  private characterTemplates: Map<string, ImageData> = new Map();
  private templatesReady = false;

  constructor(private dictionaryService: DictionaryService) {
    // Templates will be loaded on demand or built from reference
  }

  /**
   * Recognize character from canvas image using image-based matching
   * Uses template matching and image feature analysis
   */
  recognizeFromCanvas(canvas: HTMLCanvasElement, maxResults: number = 20): Observable<RecognitionResult[]> {
    if (!canvas) {
      return of([]);
    }

    return from(this.recognizeFromCanvasAsync(canvas, maxResults)).pipe(
      catchError(error => {
        console.error('[ImageRecognition] Recognition error:', error);
        return of([]);
      })
    );
  }

  /**
   * Async version of canvas recognition
   */
  private async recognizeFromCanvasAsync(canvas: HTMLCanvasElement, maxResults: number): Promise<RecognitionResult[]> {
    try {
      // Preprocess the canvas image
      const processedImage = this.preprocessImage(canvas);
      
      // Extract image features
      const features = this.extractImageFeatures(processedImage);
      
      // Match against character database using image features
      const matches = await this.matchByImageFeatures(features, maxResults);
      
      return matches;
    } catch (error) {
      console.error('[ImageRecognition] Processing error:', error);
      return [];
    }
  }

  /**
   * Preprocess canvas image for recognition
   * - Normalize size
   * - Enhance contrast
   * - Binarize if needed
   */
  private preprocessImage(canvas: HTMLCanvasElement): ImageData {
    const ctx = canvas.getContext('2d')!;
    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Create a normalized canvas (64x64 for consistency)
    const normalizedCanvas = document.createElement('canvas');
    normalizedCanvas.width = 64;
    normalizedCanvas.height = 64;
    const normalizedCtx = normalizedCanvas.getContext('2d')!;
    
    // Draw original image scaled to normalized size
    normalizedCtx.drawImage(canvas, 0, 0, 64, 64);
    
    // Get normalized image data
    const normalizedImageData = normalizedCtx.getImageData(0, 0, 64, 64);
    
    // Enhance contrast and binarize
    const enhanced = this.enhanceImage(normalizedImageData);
    
    return enhanced;
  }

  /**
   * Enhance image contrast and binarize
   */
  private enhanceImage(imageData: ImageData): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    const width = imageData.width;
    const height = imageData.height;
    
    // Calculate average brightness
    let totalBrightness = 0;
    let pixelCount = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      totalBrightness += brightness;
      pixelCount++;
    }
    
    const avgBrightness = totalBrightness / pixelCount;
    const threshold = avgBrightness * 0.7; // Adaptive threshold
    
    // Binarize and enhance contrast
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      // Binarize: black if below threshold, white if above
      const value = brightness < threshold ? 0 : 255;
      
      data[i] = value;     // R
      data[i + 1] = value; // G
      data[i + 2] = value; // B
      // Alpha stays the same
    }
    
    return new ImageData(data, width, height);
  }

  /**
   * Extract features from preprocessed image
   */
  private extractImageFeatures(imageData: ImageData): {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    density: number;
    centerOfMass: { x: number; y: number };
    aspectRatio: number;
    horizontalProjection: number[];
    verticalProjection: number[];
  } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Calculate density (percentage of black pixels)
    let blackPixels = 0;
    let totalPixels = 0;
    let sumX = 0;
    let sumY = 0;
    
    const horizontalProj = new Array(height).fill(0);
    const verticalProj = new Array(width).fill(0);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const brightness = data[idx];
        
        if (brightness < 128) { // Black pixel
          blackPixels++;
          sumX += x;
          sumY += y;
          horizontalProj[y]++;
          verticalProj[x]++;
        }
        totalPixels++;
      }
    }
    
    const density = blackPixels / totalPixels;
    const centerOfMass = {
      x: blackPixels > 0 ? sumX / blackPixels : width / 2,
      y: blackPixels > 0 ? sumY / blackPixels : height / 2
    };
    
    // Calculate aspect ratio from bounding box
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 128) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    
    const bboxWidth = maxX - minX || 1;
    const bboxHeight = maxY - minY || 1;
    const aspectRatio = bboxWidth / bboxHeight;
    
    return {
      pixels: data,
      width,
      height,
      density,
      centerOfMass,
      aspectRatio,
      horizontalProjection: horizontalProj,
      verticalProjection: verticalProj
    };
  }

  /**
   * Match image features against character database
   * Uses stroke count from dictionary and image feature similarity
   */
  private async matchByImageFeatures(
    features: ReturnType<typeof this.extractImageFeatures>,
    maxResults: number
  ): Promise<RecognitionResult[]> {
    // Get all single-character entries from dictionary
    const allEntries = await firstValueFrom(this.dictionaryService.getAllEntries());
    const singleChars = new Set<string>();
    allEntries.forEach(entry => {
      if (entry.simplified.length === 1 && /[\u4e00-\u9fff]/.test(entry.simplified)) {
        singleChars.add(entry.simplified);
      }
      if (entry.traditional.length === 1 && /[\u4e00-\u9fff]/.test(entry.traditional)) {
        singleChars.add(entry.traditional);
      }
    });
    const entries = Array.from(singleChars);

    // Score characters based on image features
    // For now, use heuristics based on stroke count and image characteristics
    const scoredChars: Array<{ character: string; score: number }> = [];
    
    for (const char of entries) {
      const strokeCount = this.dictionaryService.getStrokeCount(char);
      
      // Estimate stroke count from image features
      const estimatedStrokes = this.estimateStrokeCountFromImage(features);
      
      // Score based on stroke count match and image characteristics
      let score = 0;
      
      // Stroke count match (most important) - tighter matching
      const strokeDiff = Math.abs(strokeCount - estimatedStrokes);
      if (strokeDiff === 0) {
        score += 0.6; // Exact match is very important
      } else if (strokeDiff === 1) {
        score += 0.25; // Close match
      } else if (strokeDiff === 2) {
        score += 0.1; // Acceptable
      } else {
        // Too different, skip this character
        continue;
      }
      
      // Density match (characters should have reasonable density)
      // Most Chinese characters have 10-40% black pixels
      if (features.density >= 0.08 && features.density <= 0.45) {
        score += 0.15;
      } else if (features.density > 0.45) {
        // Too dense, might be multiple strokes overlapping
        score += 0.05;
      }
      
      // Center of mass (should be roughly centered)
      const centerX = features.centerOfMass.x / features.width;
      const centerY = features.centerOfMass.y / features.height;
      const centerDeviation = Math.abs(centerX - 0.5) + Math.abs(centerY - 0.5);
      const centerScore = Math.max(0, 1 - centerDeviation * 2);
      score += centerScore * 0.15;
      
      // Character-specific pattern matching based on projections
      // Wide characters (like 大) have more horizontal projection variation
      // Tall characters have more vertical projection variation
      const hVariation = this.calculateVariation(features.horizontalProjection);
      const vVariation = this.calculateVariation(features.verticalProjection);
      
      // Boost characters that match expected patterns
      if (features.aspectRatio > 1.2 && hVariation > vVariation) {
        score += 0.1; // Wide character pattern
      }
      if (features.aspectRatio < 0.8 && vVariation > hVariation) {
        score += 0.1; // Tall character pattern
      }
      
      if (score > 0.1) {
        scoredChars.push({ character: char, score });
      }
    }
    
    // Sort by score and return top results
    scoredChars.sort((a, b) => b.score - a.score);
    
    return scoredChars.slice(0, maxResults).map(item => ({
      character: item.character,
      confidence: Math.min(1, item.score),
      alternatives: []
    }));
  }

  /**
   * Estimate stroke count from image features
   * Uses heuristics based on image complexity
   */
  private estimateStrokeCountFromImage(features: ReturnType<typeof this.extractImageFeatures>): number {
    // Use density and projection patterns to estimate stroke count
    // More strokes = higher complexity = more black pixels and more variation
    
    const density = features.density;
    const hVariation = this.calculateVariation(features.horizontalProjection);
    const vVariation = this.calculateVariation(features.verticalProjection);
    
    // Simple heuristic: more density and variation = more strokes
    const complexity = density * (hVariation + vVariation) / 2;
    
    // Map complexity to estimated stroke count
    // These thresholds are rough estimates and may need tuning
    if (complexity < 0.1) return 1;
    if (complexity < 0.2) return 2;
    if (complexity < 0.35) return 3;
    if (complexity < 0.5) return 4;
    if (complexity < 0.65) return 5;
    if (complexity < 0.8) return 6;
    if (complexity < 1.0) return 7;
    if (complexity < 1.2) return 8;
    if (complexity < 1.5) return 9;
    return 10;
  }

  /**
   * Calculate variation in an array (standard deviation-like measure)
   */
  private calculateVariation(arr: number[]): number {
    if (arr.length === 0) return 0;
    
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (mean === 0) return 0;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  /**
   * Convert canvas to base64 PNG (for debugging or external OCR)
   */
  canvasToPNG(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL('image/png');
  }

  /**
   * Convert canvas to blob (for potential external API calls)
   */
  async canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      }, 'image/png');
    });
  }
}

