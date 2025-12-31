# Handwriting Recognition Problem Statement / PRD

## Problem Summary

When drawing the Chinese character 大 (da, meaning "big"), the handwriting recognition system ranks it at position 115 out of 245 possible matches, with only 22% confidence. Meanwhile, the character 三 (san, meaning "three") ranks first with 95% confidence. The drawn character 大 does not appear in the UI recommendations, making it unusable for users trying to look up this common character.

## Current System Architecture

### Recognition Pipeline
The system uses a three-layer processing pipeline:

1. **Preprocessing Layer** (`StrokePreprocessingService`)
   - Point filtering: Removes duplicate/very close points (distance threshold: strokeLength / 150)
   - Smoothing: Adaptive window-based smoothing (window size 2-5 based on stroke length)
   - Douglas-Peucker simplification: Currently DISABLED by default (was causing issues)
   - Current reduction: ~8-15% of points removed

2. **Normalization Layer** (`HandwritingRecognitionService.normalizeStrokes()`)
   - Scales strokes to fit 256x256 canvas (HanziLookup format)
   - Target fill ratio: 70% of available space
   - Padding: 25 pixels
   - Scale limits: 0.4 to 3.0
   - Centers character in canvas

3. **Recognition Layer** (HanziLookupJS)
   - Uses MMah dataset (9,507 characters)
   - Looseness parameter: 0.142 for 3-stroke characters (0.147 for draw-ahead)
   - Requests 500 results from HanziLookup, processes top 300
   - Lower scores = better matches

### Current Configuration
- Preprocessing: Conservative (Douglas-Peucker disabled, minimal filtering)
- Normalization: 70% fill ratio, 25px padding
- HanziLookup: Looseness 0.142-0.147 for 3-stroke characters
- Results processed: Top 300 (increased from 100 to capture 大 at rank 115)

## Observed Behavior

### When Drawing 大 (3 strokes, correct stroke order):
- **Raw HanziLookup Results**: 大 appears at rank 115 with score 2.02
- **Top Result**: 三 (rank 1, score 0.20, confidence 95%)
- **大 Confidence**: 22% (too low to be visible in UI)
- **Dictionary Lookup**: 大 exists in dictionary (verified)
- **Final Results**: 大 is included but buried at rank 115

### Key Metrics
- Total valid results: 245 characters
- 大 rank: 115/245
- 大 score: 2.02 (higher = worse match)
- 三 score: 0.20 (lower = better match)
- Score difference: 1.82 (significant gap)

## What Has Been Tried

1. **Preprocessing Adjustments**
   - Made preprocessing more conservative (disabled Douglas-Peucker)
   - Reduced filtering aggressiveness (multiplier 100 → 150)
   - Reduced tolerance values
   - Result: 大 still ranks 115th

2. **Increased Result Processing**
   - Increased from 100 to 300 results processed
   - Result: 大 now appears in results but at low rank

3. **Looseness Adjustments**
   - Slightly increased looseness for 3-stroke characters (0.14 → 0.142)
   - Result: No significant improvement

4. **Diagnostic Logging**
   - Added logging to track 大 through the pipeline
   - Confirmed: 大 is in results, exists in dictionary, but ranks low

## Root Cause Hypothesis

The drawn strokes, after preprocessing and normalization, are matching the database representation of 三 better than 大. Possible reasons:

1. **Normalization Issue**: The normalization process might be transforming the strokes in a way that makes them geometrically closer to 三 than 大
2. **Stroke Shape Similarity**: The actual drawn strokes might genuinely be closer to 三's shape in the database
3. **Database Representation**: The database representation of 大 might be different from how users typically draw it
4. **Algorithm Limitation**: HanziLookup's matching algorithm might have inherent limitations with certain stroke patterns

## Constraints

- Must work client-side (no server/API calls)
- Should maintain reasonable performance
- Must work with existing HanziLookupJS library
- Should not break recognition for other characters
- Preprocessing was added to help, so removing it entirely defeats the purpose

## Success Criteria

- 大 should appear in top 20 recommendations when drawn correctly
- Should work for other common characters (人, 中, etc.)
- Should not significantly degrade recognition for characters that currently work well
- Solution should be data-driven, not arbitrary boosting

## Questions to Answer

1. Why does the normalized stroke shape match 三 better than 大?
2. What does the normalized stroke data actually look like?
3. How does it compare to reference 大 stroke data?
4. Which layer (preprocessing, normalization, matching) is causing the mismatch?
5. Can we adjust parameters to make 大 match better without hurting other characters?

## Desired Solution Characteristics

- **Systematic**: Based on data and testing, not guesswork
- **Diagnostic**: Helps understand WHY the issue occurs
- **Tunable**: Allows fine-tuning based on findings
- **Scalable**: Works for other characters with similar issues
- **Maintainable**: Clear, understandable solution

## Technical Context

- **Framework**: Angular 17
- **Recognition Library**: HanziLookupJS (MMah dataset)
- **Preprocessing**: Custom implementation with GEOS-WASM (optional)
- **Canvas Size**: 400x400 pixels (user drawing)
- **Normalized Size**: 256x256 (HanziLookup format, coordinates 0-255)
- **Stroke Format**: `number[][][]` - array of strokes, each stroke is array of [x, y] points

## Available Tools

- Preprocessing service with configurable parameters
- Normalization with adjustable fill ratio, padding, scale limits
- HanziLookup with adjustable looseness per stroke count
- Diagnostic logging capabilities
- Ability to bypass preprocessing for testing
- Dictionary service for character lookup

## Open Questions

1. Should we build diagnostic visualization tools first?
2. Should we create an automated testing harness?
3. Should we try a transformer-based approach instead?
4. Is the current approach fundamentally limited?
5. What would make 大 match better in HanziLookup?

## Request for Ideas

We need creative solutions to:
- Diagnose why 大 ranks so low
- Improve 大's ranking without breaking other characters
- Systematically tune the three-layer pipeline
- Determine if current approach is viable or if we need a different solution

Any ideas, approaches, or solutions are welcome. The goal is to make 大 (and similar common characters) appear in top recommendations when drawn correctly.


