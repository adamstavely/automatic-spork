/**
 * Type definitions for stroke-based feature extraction and matching
 */

export interface StrokeFeatureVector {
  strokeCount: number;
  strokeDirections: number[]; // Angles in degrees for each stroke
  strokeLengths: number[]; // Length of each stroke
  strokeStartAngles: number[]; // Angle at start of stroke
  strokeEndAngles: number[]; // Angle at end of stroke
  intersections: IntersectionPoint[]; // Points where strokes intersect
  boundingBox: {
    width: number;
    height: number;
    aspectRatio: number;
    centerX: number;
    centerY: number;
  };
  curvature: number[]; // Curvature measure for each stroke
  horizontalLines: number; // Count of horizontal strokes
  verticalLines: number; // Count of vertical strokes
  diagonalLines: number; // Count of diagonal strokes
}

export interface IntersectionPoint {
  x: number;
  y: number;
  stroke1Index: number;
  stroke2Index: number;
}

export interface CharacterFeatureData {
  character: string;
  features: StrokeFeatureVector;
  strokeCount: number;
}

export interface StrokeMatchResult {
  character: string;
  similarity: number; // 0-1, higher is better
  confidence: number; // 0-1
  matchedFeatures: {
    direction: number;
    length: number;
    intersections: number;
    structure: number;
  };
}

