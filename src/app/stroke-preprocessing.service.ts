import { Injectable } from '@angular/core';

/**
 * Service for preprocessing stroke data to improve handwriting recognition accuracy.
 * Implements point filtering, smoothing, and Douglas-Peucker simplification.
 */
interface PreprocessingConfig {
  pointFilterMultiplier: number;      // strokeLength / this for filtering distance
  toleranceMultiplier: number;        // diagonal * this for Douglas-Peucker tolerance
  minTolerance: number;                // minimum tolerance value
  enableDouglasPeucker: boolean;       // can disable for testing
  debugMode: boolean;                  // enable diagnostic logging
}

@Injectable({
  providedIn: 'root'
})
export class StrokePreprocessingService {
  private geosInitialized = false;
  private geosInitializing = false;
  private geos: any = null;

  // Configurable parameters with sensible defaults - conservative settings to preserve stroke detail
  private config: PreprocessingConfig = {
    pointFilterMultiplier: 150,      // strokeLength / this (less aggressive filtering)
    toleranceMultiplier: 0.01,        // diagonal * this (more conservative, reduced from 0.02)
    minTolerance: 0.1,                // minimum tolerance (lower, reduced from 0.2)
    enableDouglasPeucker: false,      // disabled by default to preserve stroke detail
    debugMode: false                   // enable diagnostic logging
  };

  constructor() {
    this.initializeGeos();
  }

  /**
   * Enable or disable debug mode for diagnostic logging
   */
  setDebugMode(enabled: boolean): void {
    this.config.debugMode = enabled;
  }

  /**
   * Update preprocessing configuration
   */
  updateConfig(updates: Partial<PreprocessingConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): PreprocessingConfig {
    return { ...this.config };
  }

  /**
   * Apply preset configuration for conservative preprocessing
   * Less filtering, less simplification - preserves more detail
   */
  useConservativePreset(): void {
    this.config = {
      pointFilterMultiplier: 150,      // Less aggressive filtering
      toleranceMultiplier: 0.01,        // Lower tolerance (less simplification)
      minTolerance: 0.1,                // Lower minimum
      enableDouglasPeucker: true,
      debugMode: this.config.debugMode
    };
    if (this.config.debugMode) {
      console.log('[Preprocessing] Applied conservative preset');
    }
  }

  /**
   * Apply preset configuration for aggressive preprocessing
   * More filtering, more simplification - removes more noise
   */
  useAggressivePreset(): void {
    this.config = {
      pointFilterMultiplier: 50,       // More aggressive filtering
      toleranceMultiplier: 0.05,        // Higher tolerance (more simplification)
      minTolerance: 0.5,                // Higher minimum
      enableDouglasPeucker: true,
      debugMode: this.config.debugMode
    };
    if (this.config.debugMode) {
      console.log('[Preprocessing] Applied aggressive preset');
    }
  }

  /**
   * Apply preset configuration for balanced preprocessing
   * Default balanced approach with tuned values
   */
  useBalancedPreset(): void {
    this.config = {
      pointFilterMultiplier: 100,      // Balanced filtering
      toleranceMultiplier: 0.02,        // Moderate tolerance
      minTolerance: 0.2,                // Moderate minimum
      enableDouglasPeucker: true,
      debugMode: this.config.debugMode
    };
    if (this.config.debugMode) {
      console.log('[Preprocessing] Applied balanced preset');
    }
  }

  /**
   * Disable all preprocessing (for testing/comparison)
   */
  disablePreprocessing(): void {
    this.config.enableDouglasPeucker = false;
    if (this.config.debugMode) {
      console.log('[Preprocessing] Preprocessing disabled (only filtering/smoothing will run)');
    }
  }

  /**
   * Enable all preprocessing
   */
  enablePreprocessing(): void {
    this.config.enableDouglasPeucker = true;
    if (this.config.debugMode) {
      console.log('[Preprocessing] Preprocessing enabled');
    }
  }

  /**
   * Initialize GEOS-WASM library
   */
  private async initializeGeos(): Promise<void> {
    if (this.geosInitialized || this.geosInitializing) {
      return;
    }

    this.geosInitializing = true;
    try {
      // Dynamic import to handle module loading
      const initGeosJs = (await import('geos-wasm')).default;
      this.geos = await initGeosJs();
      this.geosInitialized = true;
      console.log('GEOS-WASM initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize GEOS-WASM, will use fallback methods:', error);
      this.geosInitialized = false;
    } finally {
      this.geosInitializing = false;
    }
  }

  /**
   * Check if GEOS is ready for use
   */
  private isGeosReady(): boolean {
    return this.geosInitialized && this.geos !== null;
  }

  /**
   * Log preprocessing step with before/after statistics
   */
  private logPreprocessingStep(step: string, before: number[][], after: number[][]): void {
    if (this.config.debugMode) {
      const reduction = before.length > 0 
        ? ((1 - after.length / before.length) * 100).toFixed(1)
        : '0.0';
      console.log(`[Preprocessing] ${step}:`, {
        beforePoints: before.length,
        afterPoints: after.length,
        reduction: `${reduction}%`
      });
    }
  }

  /**
   * Calculate stroke statistics for logging
   */
  private getStrokeStats(stroke: number[][]): {
    pointCount: number;
    boundingBox: { width: number; height: number; diagonal: number };
    totalLength: number;
  } {
    if (stroke.length < 2) {
      return { pointCount: stroke.length, boundingBox: { width: 0, height: 0, diagonal: 0 }, totalLength: 0 };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let totalLength = 0;

    stroke.forEach((point, index) => {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);

      if (index > 0) {
        const dx = point[0] - stroke[index - 1][0];
        const dy = point[1] - stroke[index - 1][1];
        totalLength += Math.sqrt(dx * dx + dy * dy);
      }
    });

    const width = maxX - minX;
    const height = maxY - minY;
    const diagonal = Math.sqrt(width * width + height * height);

    return {
      pointCount: stroke.length,
      boundingBox: { width, height, diagonal },
      totalLength
    };
  }

  /**
   * Main preprocessing pipeline: filter → smooth → simplify
   * Stroke format: [[x, y], [x, y], ...]
   */
  preprocessStroke(stroke: number[][]): number[][] {
    if (!stroke || stroke.length < 2) {
      return stroke;
    }

    // Log initial stroke statistics
    const initialStats = this.getStrokeStats(stroke);
    if (this.config.debugMode) {
      console.log('[Preprocessing] Starting pipeline:', {
        strokeIndex: 'single',
        initialStats
      });
    }

    try {
      let processed = stroke;

      // Step 1: Filter points (remove duplicates/very close points)
      try {
        const beforeFilter = processed;
        processed = this.filterPoints(processed);
        // Ensure we still have at least 2 points after filtering
        if (processed.length < 2) {
          processed = stroke; // Fallback to original if filtering removed too many points
        }
        this.logPreprocessingStep('Filter Points', beforeFilter, processed);
      } catch (error) {
        console.warn('Point filtering failed, skipping:', error);
        // Continue with original stroke
      }

      // Step 2: Smooth the stroke
      try {
        const beforeSmooth = processed;
        processed = this.smoothStroke(processed);
        // Ensure we still have at least 2 points after smoothing
        if (processed.length < 2) {
          processed = stroke; // Fallback to original if smoothing failed
        }
        this.logPreprocessingStep('Smooth Stroke', beforeSmooth, processed);
      } catch (error) {
        console.warn('Stroke smoothing failed, skipping:', error);
        // Continue with filtered stroke or original
      }

      // Step 3: Simplify using Douglas-Peucker (if GEOS available and enabled)
      if (this.config.enableDouglasPeucker && this.isGeosReady() && processed.length > 2) {
        try {
          const beforeSimplify = processed;
          const simplified = this.simplifyWithDouglasPeucker(processed);
          // Only use simplified version if it has at least 2 points
          if (simplified && simplified.length >= 2) {
            processed = simplified;
          }
          this.logPreprocessingStep('Douglas-Peucker Simplify', beforeSimplify, processed);
        } catch (error) {
          console.warn('Douglas-Peucker simplification failed, using smoothed stroke:', error);
          // Continue with smoothed stroke if simplification fails
        }
      } else if (this.config.debugMode) {
        if (!this.config.enableDouglasPeucker) {
          console.log('[Preprocessing] Douglas-Peucker disabled in config');
        } else if (!this.isGeosReady()) {
          console.log('[Preprocessing] GEOS-WASM not ready, skipping simplification');
        } else {
          console.log('[Preprocessing] Stroke too short for simplification (< 3 points)');
        }
      }

      // Final validation: ensure we return a valid stroke
      if (!processed || processed.length < 2) {
        return stroke; // Fallback to original if preprocessing failed
      }

      // Log final statistics
      const finalStats = this.getStrokeStats(processed);
      if (this.config.debugMode) {
        console.log('[Preprocessing] Pipeline complete:', {
          initialStats,
          finalStats,
          totalReduction: `${((1 - finalStats.pointCount / initialStats.pointCount) * 100).toFixed(1)}%`
        });
      }

      return processed;
    } catch (error) {
      console.error('Preprocessing pipeline failed, returning original stroke:', error);
      return stroke; // Always return original stroke as fallback
    }
  }

  /**
   * Preprocess all strokes in a stroke array
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  preprocessStrokes(strokes: number[][][]): number[][][] {
    if (!strokes || strokes.length === 0) {
      return strokes;
    }

    // Always-visible logging (not just in debug mode)
    const totalInitialPoints = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
    console.log('[Preprocessing] Starting:', {
      strokeCount: strokes.length,
      totalPoints: totalInitialPoints,
      douglasPeuckerEnabled: this.config.enableDouglasPeucker && this.isGeosReady()
    });

    try {
      const preprocessed = strokes.map((stroke, index) => {
        try {
          if (this.config.debugMode) {
            console.log(`[Preprocessing] Processing stroke ${index + 1}/${strokes.length}`);
          }
          return this.preprocessStroke(stroke);
        } catch (error) {
          console.warn(`Failed to preprocess stroke ${index + 1}, using original:`, error);
          return stroke; // Return original stroke if preprocessing fails
        }
      }).filter(stroke => stroke && stroke.length >= 2); // Filter out invalid strokes

      // Always-visible logging of results
      const totalFinalPoints = preprocessed.reduce((sum, stroke) => sum + stroke.length, 0);
      const reduction = totalInitialPoints > 0 
        ? ((1 - totalFinalPoints / totalInitialPoints) * 100).toFixed(1)
        : '0.0';
      console.log('[Preprocessing] Complete:', {
        strokeCount: preprocessed.length,
        totalPoints: totalFinalPoints,
        reduction: `${reduction}%`,
        douglasPeuckerUsed: this.config.enableDouglasPeucker && this.isGeosReady()
      });

      return preprocessed;
    } catch (error) {
      console.error('Preprocessing strokes array failed, returning original:', error);
      return strokes; // Fallback to original strokes array
    }
  }

  /**
   * Filter out duplicate or very close points
   * Preserves endpoints and calculates minimum distance automatically
   * Stroke format: [[x, y], [x, y], ...]
   */
  filterPoints(stroke: number[][]): number[][] {
    if (stroke.length < 2) {
      return stroke;
    }

    // Calculate stroke length for auto-calculation
    let totalLength = 0;
    for (let i = 1; i < stroke.length; i++) {
      const dx = stroke[i][0] - stroke[i - 1][0];
      const dy = stroke[i][1] - stroke[i - 1][1];
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }

    // Auto-calculate minimum distance: min(1, strokeLength / pointFilterMultiplier)
    const minDistance = Math.min(1, totalLength / this.config.pointFilterMultiplier);

    const filtered: number[][] = [];
    
    // Always preserve first point
    filtered.push([stroke[0][0], stroke[0][1]]);

    for (let i = 1; i < stroke.length - 1; i++) {
      const prevPoint = filtered[filtered.length - 1];
      const currentPoint = stroke[i];
      
      const dx = currentPoint[0] - prevPoint[0];
      const dy = currentPoint[1] - prevPoint[1];
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Keep point if it's far enough from previous point
      if (distance >= minDistance) {
        filtered.push([currentPoint[0], currentPoint[1]]);
      }
    }

    // Always preserve last point
    const lastPoint = stroke[stroke.length - 1];
    if (filtered.length === 0 || 
        (lastPoint[0] !== filtered[filtered.length - 1][0] || 
         lastPoint[1] !== filtered[filtered.length - 1][1])) {
      filtered.push([lastPoint[0], lastPoint[1]]);
    }

    // Ensure we have at least 2 points
    if (filtered.length < 2 && stroke.length >= 2) {
      return [[stroke[0][0], stroke[0][1]], [stroke[stroke.length - 1][0], stroke[stroke.length - 1][1]]];
    }

    return filtered;
  }

  /**
   * Smooth stroke to reduce noise from hand-drawn input
   * Uses adaptive smoothing based on stroke length
   * Stroke format: [[x, y], [x, y], ...]
   */
  smoothStroke(stroke: number[][]): number[][] {
    if (stroke.length < 3) {
      return stroke;
    }

    // Adaptive window size based on stroke length
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
   * Simplify stroke using Douglas-Peucker algorithm via GEOS-WASM
   * Stroke format: [[x, y], [x, y], ...]
   */
  simplifyWithDouglasPeucker(stroke: number[][]): number[][] {
    if (!this.isGeosReady() || stroke.length < 3) {
      return stroke;
    }

    let reader: any = null;
    let writer: any = null;
    let geom: any = null;
    let simplifiedGeom: any = null;
    let wktPtr: number | null = null;
    let simplifiedWktPtr: number | null = null;

    try {
      // Calculate bounding box for auto-tolerance calculation
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      stroke.forEach(point => {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      });

      const width = maxX - minX;
      const height = maxY - minY;
      const diagonal = Math.sqrt(width * width + height * height);

      // Calculate point density factor (more points = higher density = can simplify more)
      const pointDensity = stroke.length / Math.max(diagonal, 1);
      const densityFactor = Math.min(1.5, 1 + (pointDensity / 100)); // Cap at 1.5x

      // Improved tolerance calculation: considers stroke size and point density
      // Formula: max(minTolerance, diagonal * multiplier * densityFactor)
      const tolerance = Math.max(
        this.config.minTolerance,
        diagonal * this.config.toleranceMultiplier * densityFactor
      );

      if (this.config.debugMode) {
        console.log('[Preprocessing] Douglas-Peucker parameters:', {
          boundingBox: { width, height, diagonal },
          pointCount: stroke.length,
          pointDensity: pointDensity.toFixed(2),
          densityFactor: densityFactor.toFixed(2),
          tolerance: tolerance.toFixed(3),
          config: {
            toleranceMultiplier: this.config.toleranceMultiplier,
            minTolerance: this.config.minTolerance
          }
        });
      }

      // Create WKT LineString from stroke points
      const coords = stroke.map(p => `${p[0]} ${p[1]}`).join(', ');
      const wkt = `LINESTRING(${coords})`;

      // Create WKT reader
      reader = this.geos.GEOSWKTReader_create();
      if (!reader) {
        return stroke;
      }

      // Allocate memory for WKT string
      const wktSize = wkt.length + 1;
      wktPtr = this.geos.Module._malloc(wktSize);
      if (!wktPtr) {
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      // Copy WKT string to allocated memory
      this.geos.Module.stringToUTF8(wkt, wktPtr, wktSize);

      // Read the WKT string into a GEOS geometry
      geom = this.geos.GEOSWKTReader_read(reader, wktPtr);

      // Free input WKT memory
      this.geos.Module._free(wktPtr);
      wktPtr = null;

      if (!geom) {
        // Failed to create geometry, clean up and return original
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      // Apply Douglas-Peucker simplification
      simplifiedGeom = this.geos.GEOSSimplify(geom, tolerance);

      if (!simplifiedGeom) {
        // Simplification failed, clean up and return original
        this.geos.GEOSGeom_destroy(geom);
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      // Create WKT writer to get simplified coordinates
      writer = this.geos.GEOSWKTWriter_create();
      if (!writer) {
        this.geos.GEOSGeom_destroy(simplifiedGeom);
        this.geos.GEOSGeom_destroy(geom);
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      // Write simplified geometry to WKT (returns a pointer)
      simplifiedWktPtr = this.geos.GEOSWKTWriter_write(writer, simplifiedGeom);

      if (!simplifiedWktPtr) {
        // Failed to write WKT, clean up and return original
        this.geos.GEOSWKTWriter_destroy(writer);
        this.geos.GEOSGeom_destroy(simplifiedGeom);
        this.geos.GEOSGeom_destroy(geom);
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      // Convert pointer to JavaScript string
      const simplifiedWkt = this.geos.Module.UTF8ToString(simplifiedWktPtr);

      // Free the WKT string pointer (GEOS allocates it, we need to free it)
      this.geos.GEOSFree(simplifiedWktPtr);
      simplifiedWktPtr = null;

      // Parse simplified WKT back to points
      // Format: LINESTRING(x1 y1, x2 y2, ...)
      const coordsMatch = simplifiedWkt.match(/LINESTRING\((.+)\)/);
      if (!coordsMatch) {
        // Failed to parse, clean up and return original
        this.geos.GEOSWKTWriter_destroy(writer);
        this.geos.GEOSGeom_destroy(simplifiedGeom);
        this.geos.GEOSGeom_destroy(geom);
        this.geos.GEOSWKTReader_destroy(reader);
        return stroke;
      }

      const simplifiedPoints: number[][] = coordsMatch[1]
        .split(',')
        .map((coord: string) => {
          const parts = coord.trim().split(/\s+/);
          return [parseFloat(parts[0]), parseFloat(parts[1])];
        })
        .filter((point: number[]) => !isNaN(point[0]) && !isNaN(point[1]));

      // Clean up GEOS resources
      this.geos.GEOSWKTWriter_destroy(writer);
      this.geos.GEOSGeom_destroy(simplifiedGeom);
      this.geos.GEOSGeom_destroy(geom);
      this.geos.GEOSWKTReader_destroy(reader);

      // Ensure we have at least 2 points
      if (simplifiedPoints.length < 2) {
        return stroke;
      }

      return simplifiedPoints;
    } catch (error) {
      console.error('Error in Douglas-Peucker simplification:', error);
      
      // Clean up any remaining resources
      if (simplifiedWktPtr !== null) {
        try {
          this.geos.GEOSFree(simplifiedWktPtr);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (wktPtr !== null) {
        try {
          this.geos.Module._free(wktPtr);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (writer) {
        try {
          this.geos.GEOSWKTWriter_destroy(writer);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (simplifiedGeom) {
        try {
          this.geos.GEOSGeom_destroy(simplifiedGeom);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (geom) {
        try {
          this.geos.GEOSGeom_destroy(geom);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (reader) {
        try {
          this.geos.GEOSWKTReader_destroy(reader);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      return stroke;
    }
  }
}


