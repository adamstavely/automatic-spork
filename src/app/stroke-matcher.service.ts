import { Injectable } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DictionaryService } from './dictionary.service';
import { RecognitionResult } from './types/handwriting.types';
import { StrokeFeatureVector, CharacterFeatureData, StrokeMatchResult, IntersectionPoint } from './types/stroke-features.types';

@Injectable({
  providedIn: 'root'
})
export class StrokeMatcherService {
  private characterDatabase: Map<number, CharacterFeatureData[]> = new Map();
  private databaseReady = false;
  private databaseInitializing = false;

  // Feature weights for similarity calculation
  private readonly FEATURE_WEIGHTS = {
    direction: 0.35,      // Stroke directions are most important
    length: 0.25,        // Stroke lengths are important
    intersections: 0.20, // Intersections help distinguish characters
    structure: 0.20     // Overall structure (aspect ratio, etc.)
  };

  constructor(private dictionaryService: DictionaryService) {
    this.buildCharacterDatabase();
  }

  /**
   * Build character feature database from dictionary entries
   */
  private buildCharacterDatabase(): void {
    if (this.databaseInitializing || this.databaseReady) {
      return;
    }

    this.databaseInitializing = true;

    this.dictionaryService.getAllEntries().subscribe(entries => {
      const charMap = new Map<string, { entry: any; strokeCount: number }>();

      // Collect all single-character entries
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

      // Extract features for each character
      charMap.forEach(({ entry, strokeCount }, character) => {
        const features = this.extractCharacterFeatures(character, strokeCount);
        
        if (!this.characterDatabase.has(strokeCount)) {
          this.characterDatabase.set(strokeCount, []);
        }

        this.characterDatabase.get(strokeCount)!.push({
          character: character,
          features: features,
          strokeCount: strokeCount
        });
      });

      this.databaseReady = true;
      this.databaseInitializing = false;
      console.log('[StrokeMatcher] Character database built:', {
        totalCharacters: charMap.size,
        byStrokeCount: Array.from(this.characterDatabase.entries()).map(([count, chars]) => ({
          strokeCount: count,
          characterCount: chars.length
        }))
      });
    });
  }

  /**
   * Extract features from a character (heuristic-based for now)
   * In a full implementation, this would analyze actual stroke data
   */
  private extractCharacterFeatures(character: string, strokeCount: number): StrokeFeatureVector {
    // This is a simplified feature extraction
    // In a real implementation, we'd need reference stroke data for each character
    // For now, we'll use heuristics based on character structure

    const features: StrokeFeatureVector = {
      strokeCount: strokeCount,
      strokeDirections: [],
      strokeLengths: [],
      strokeStartAngles: [],
      strokeEndAngles: [],
      intersections: [],
      boundingBox: {
        width: 1,
        height: 1,
        aspectRatio: 1,
        centerX: 0.5,
        centerY: 0.5
      },
      curvature: [],
      horizontalLines: 0,
      verticalLines: 0,
      diagonalLines: 0
    };

    // Simple heuristics based on common stroke patterns
    // This is a placeholder - real implementation needs reference data
    for (let i = 0; i < strokeCount; i++) {
      features.strokeDirections.push(0);
      features.strokeLengths.push(1);
      features.strokeStartAngles.push(0);
      features.strokeEndAngles.push(0);
      features.curvature.push(0);
    }

    return features;
  }

  /**
   * Extract features from drawn strokes
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  extractStrokeFeatures(strokes: number[][][]): StrokeFeatureVector {
    const features: StrokeFeatureVector = {
      strokeCount: strokes.length,
      strokeDirections: [],
      strokeLengths: [],
      strokeStartAngles: [],
      strokeEndAngles: [],
      intersections: [],
      boundingBox: this.calculateBoundingBox(strokes),
      curvature: [],
      horizontalLines: 0,
      verticalLines: 0,
      diagonalLines: 0
    };

    // Extract features for each stroke
    for (const stroke of strokes) {
      if (stroke.length < 2) {
        features.strokeDirections.push(0);
        features.strokeLengths.push(0);
        features.strokeStartAngles.push(0);
        features.strokeEndAngles.push(0);
        features.curvature.push(0);
        continue;
      }

      const start = stroke[0];
      const end = stroke[stroke.length - 1];
      
      // Calculate direction (angle from start to end)
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      features.strokeDirections.push(angle);

      // Calculate length
      let length = 0;
      for (let i = 1; i < stroke.length; i++) {
        const dx = stroke[i][0] - stroke[i - 1][0];
        const dy = stroke[i][1] - stroke[i - 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
      }
      features.strokeLengths.push(length);

      // Start and end angles
      if (stroke.length >= 2) {
        const startDx = stroke[1][0] - stroke[0][0];
        const startDy = stroke[1][1] - stroke[0][1];
        features.strokeStartAngles.push(Math.atan2(startDy, startDx) * (180 / Math.PI));

        const endDx = stroke[stroke.length - 1][0] - stroke[stroke.length - 2][0];
        const endDy = stroke[stroke.length - 1][1] - stroke[stroke.length - 2][1];
        features.strokeEndAngles.push(Math.atan2(endDy, endDx) * (180 / Math.PI));
      } else {
        features.strokeStartAngles.push(angle);
        features.strokeEndAngles.push(angle);
      }

      // Calculate curvature (simplified - measure deviation from straight line)
      const straightLineLength = Math.sqrt(dx * dx + dy * dy);
      const curvature = straightLineLength > 0 ? (length / straightLineLength) - 1 : 0;
      features.curvature.push(curvature);

      // Classify stroke type
      const absAngle = Math.abs(angle);
      if (absAngle < 30 || absAngle > 150) {
        features.horizontalLines++;
      } else if (Math.abs(absAngle - 90) < 30) {
        features.verticalLines++;
      } else {
        features.diagonalLines++;
      }
    }

    // Find intersections between strokes
    features.intersections = this.findIntersections(strokes);

    return features;
  }

  /**
   * Calculate bounding box of strokes
   */
  private calculateBoundingBox(strokes: number[][][]): {
    width: number;
    height: number;
    aspectRatio: number;
    centerX: number;
    centerY: number;
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

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      width: width || 1,
      height: height || 1,
      aspectRatio: height > 0 ? width / height : 1,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * Find intersection points between strokes
   */
  private findIntersections(strokes: number[][][]): IntersectionPoint[] {
    const intersections: IntersectionPoint[] = [];

    for (let i = 0; i < strokes.length; i++) {
      for (let j = i + 1; j < strokes.length; j++) {
        const intersection = this.findStrokeIntersection(strokes[i], strokes[j]);
        if (intersection) {
          intersections.push({
            x: intersection.x,
            y: intersection.y,
            stroke1Index: i,
            stroke2Index: j
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Find intersection point between two strokes (simplified)
   */
  private findStrokeIntersection(stroke1: number[][], stroke2: number[][]): { x: number; y: number } | null {
    // Simplified intersection detection - check if strokes are close
    // Full implementation would check line segment intersections
    
    const threshold = 5; // pixels

    for (const p1 of stroke1) {
      for (const p2 of stroke2) {
        const dx = p1[0] - p2[0];
        const dy = p1[1] - p2[1];
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < threshold) {
          return { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
        }
      }
    }

    return null;
  }

  /**
   * Calculate similarity between two feature vectors
   * Improved to handle placeholder features in database
   */
  private calculateSimilarity(features1: StrokeFeatureVector, features2: StrokeFeatureVector): number {
    // If database features are placeholders (empty arrays), use simplified matching
    const isPlaceholder = features2.strokeDirections.length === 0 && 
                          features2.strokeLengths.length === 0;
    
    if (isPlaceholder) {
      // Simplified matching when database has placeholder features
      // Focus on stroke count and basic structure
      let score = 0;
      
      // Stroke count match (most important)
      const strokeCountDiff = Math.abs(features1.strokeCount - features2.strokeCount);
      if (strokeCountDiff === 0) {
        score = 0.6; // Base score for exact stroke count match
      } else if (strokeCountDiff === 1) {
        score = 0.3; // Partial match
      } else {
        return 0; // Too different
      }
      
      // Add structure bonuses
      const aspectRatio = features1.boundingBox.aspectRatio;
      
      // Common patterns based on aspect ratio and line types
      // Wide characters (like 大) have aspect ratio > 1.2
      // Tall characters have aspect ratio < 0.8
      // Square characters have aspect ratio ~1.0
      if (aspectRatio > 1.2 && features1.horizontalLines > 0) {
        score += 0.1; // Likely a wide character with horizontal strokes
      }
      if (aspectRatio < 0.8 && features1.verticalLines > 0) {
        score += 0.1; // Likely a tall character with vertical strokes
      }
      if (Math.abs(aspectRatio - 1.0) < 0.2) {
        score += 0.05; // Square-ish character
      }
      
      // Diagonal lines bonus (for characters like 人, 大)
      if (features1.diagonalLines >= 2) {
        score += 0.1;
      }
      
      // Intersections bonus (more intersections = more complex character)
      if (features1.intersections.length > 0) {
        score += Math.min(0.1, features1.intersections.length * 0.02);
      }
      
      return Math.min(1, score);
    }
    
    // Full feature matching when database has real features
    let similarity = 0;
    let totalWeight = 0;

    // Stroke count match (must be exact or very close)
    const strokeCountDiff = Math.abs(features1.strokeCount - features2.strokeCount);
    if (strokeCountDiff > 1) {
      return 0; // Too different in stroke count
    }
    const strokeCountScore = strokeCountDiff === 0 ? 1 : 0.5;
    similarity += strokeCountScore * 0.1;
    totalWeight += 0.1;

    // Direction similarity
    if (features1.strokeDirections.length > 0 && features2.strokeDirections.length > 0) {
      const directionScore = this.compareAngles(features1.strokeDirections, features2.strokeDirections);
      similarity += directionScore * this.FEATURE_WEIGHTS.direction;
      totalWeight += this.FEATURE_WEIGHTS.direction;
    }

    // Length similarity
    if (features1.strokeLengths.length > 0 && features2.strokeLengths.length > 0) {
      const lengthScore = this.compareLengths(features1.strokeLengths, features2.strokeLengths);
      similarity += lengthScore * this.FEATURE_WEIGHTS.length;
      totalWeight += this.FEATURE_WEIGHTS.length;
    }

    // Intersection similarity
    const intersectionScore = this.compareIntersections(features1.intersections, features2.intersections);
    similarity += intersectionScore * this.FEATURE_WEIGHTS.intersections;
    totalWeight += this.FEATURE_WEIGHTS.intersections;

    // Structure similarity (aspect ratio, line types)
    const structureScore = this.compareStructure(features1, features2);
    similarity += structureScore * this.FEATURE_WEIGHTS.structure;
    totalWeight += this.FEATURE_WEIGHTS.structure;

    // Normalize by total weight
    return totalWeight > 0 ? similarity / totalWeight : 0;
  }

  /**
   * Compare angle arrays
   */
  private compareAngles(angles1: number[], angles2: number[]): number {
    if (angles1.length !== angles2.length) {
      return 0;
    }

    let totalScore = 0;
    for (let i = 0; i < angles1.length; i++) {
      const diff = Math.abs(angles1[i] - angles2[i]);
      const normalizedDiff = Math.min(diff, 360 - diff) / 180; // Normalize to 0-1
      totalScore += 1 - normalizedDiff;
    }

    return totalScore / angles1.length;
  }

  /**
   * Compare length arrays
   */
  private compareLengths(lengths1: number[], lengths2: number[]): number {
    if (lengths1.length !== lengths2.length || lengths1.length === 0) {
      return 0;
    }

    // Normalize lengths
    const max1 = Math.max(...lengths1, 1);
    const max2 = Math.max(...lengths2, 1);
    const normalized1 = lengths1.map(l => l / max1);
    const normalized2 = lengths2.map(l => l / max2);

    let totalScore = 0;
    for (let i = 0; i < normalized1.length; i++) {
      const diff = Math.abs(normalized1[i] - normalized2[i]);
      totalScore += 1 - diff;
    }

    return totalScore / normalized1.length;
  }

  /**
   * Compare intersections
   */
  private compareIntersections(intersections1: IntersectionPoint[], intersections2: IntersectionPoint[]): number {
    // Simple comparison based on count and approximate positions
    if (intersections1.length === 0 && intersections2.length === 0) {
      return 1;
    }

    const countDiff = Math.abs(intersections1.length - intersections2.length);
    const maxCount = Math.max(intersections1.length, intersections2.length, 1);
    const countScore = 1 - (countDiff / maxCount);

    return countScore;
  }

  /**
   * Compare structure features
   */
  private compareStructure(features1: StrokeFeatureVector, features2: StrokeFeatureVector): number {
    let score = 0;
    let factors = 0;

    // Aspect ratio
    const aspectDiff = Math.abs(features1.boundingBox.aspectRatio - features2.boundingBox.aspectRatio);
    const aspectScore = 1 - Math.min(aspectDiff, 1);
    score += aspectScore;
    factors++;

    // Line type distribution
    const total1 = features1.horizontalLines + features1.verticalLines + features1.diagonalLines;
    const total2 = features2.horizontalLines + features2.verticalLines + features2.diagonalLines;
    
    if (total1 > 0 && total2 > 0) {
      const hDiff = Math.abs(features1.horizontalLines / total1 - features2.horizontalLines / total2);
      const vDiff = Math.abs(features1.verticalLines / total1 - features2.verticalLines / total2);
      const dDiff = Math.abs(features1.diagonalLines / total1 - features2.diagonalLines / total2);
      
      const lineTypeScore = 1 - (hDiff + vDiff + dDiff) / 3;
      score += lineTypeScore;
      factors++;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Match strokes against character database
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  match(strokes: number[][][], maxResults: number = 20): Observable<RecognitionResult[]> {
    if (!strokes || strokes.length === 0) {
      return of([]);
    }

    // Wait for database to be ready
    if (!this.databaseReady) {
      // Wait a bit and retry
      return new Observable(observer => {
        const checkInterval = setInterval(() => {
          if (this.databaseReady) {
            clearInterval(checkInterval);
            this.match(strokes, maxResults).subscribe(observer);
          }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!this.databaseReady) {
            observer.next([]);
            observer.complete();
          }
        }, 5000);
      });
    }

    // Extract features from input strokes
    const inputFeatures = this.extractStrokeFeatures(strokes);
    const strokeCount = strokes.length;

    console.log('[StrokeMatcher] Matching', strokeCount, 'strokes. Database has characters with stroke counts:', 
      Array.from(this.characterDatabase.keys()).sort((a, b) => a - b));

    // Get candidate characters - prioritize exact match, then ±1
    const candidates: CharacterFeatureData[] = [];
    
    // First try exact stroke count match
    const exactMatch = this.characterDatabase.get(strokeCount) || [];
    candidates.push(...exactMatch);
    
    // Then try ±1 if we don't have enough candidates
    if (candidates.length < 10) {
      for (let count = Math.max(1, strokeCount - 1); count <= strokeCount + 1; count++) {
        if (count !== strokeCount) {
          const chars = this.characterDatabase.get(count) || [];
          candidates.push(...chars);
        }
      }
    }

    console.log('[StrokeMatcher] Found', candidates.length, 'candidates (exact match:', exactMatch.length, ')');

    if (candidates.length === 0) {
      console.warn('[StrokeMatcher] No candidates found for', strokeCount, 'strokes');
      return of([]);
    }

    // Calculate similarity for each candidate
    const matches: StrokeMatchResult[] = candidates.map(candidate => {
      const similarity = this.calculateSimilarity(inputFeatures, candidate.features);
      
      // No boosting - use raw similarity score
      const confidence = Math.min(1, similarity);

      return {
        character: candidate.character,
        similarity: similarity,
        confidence: confidence,
        matchedFeatures: {
          direction: 0,
          length: 0,
          intersections: 0,
          structure: 0
        }
      };
    });

    // Sort by similarity (descending) - no boosting applied
    matches.sort((a, b) => b.similarity - a.similarity);
    
    // Log top matches for debugging
    console.log('[StrokeMatcher] Top 10 matches:', matches.slice(0, 10).map(m => 
      `${m.character} (${(m.confidence * 100).toFixed(1)}%)`
    ));

    // Convert to RecognitionResult format
    const results: RecognitionResult[] = matches.slice(0, maxResults).map(match => ({
      character: match.character,
      confidence: match.confidence,
      alternatives: []
    }));

    return of(results);
  }
}

